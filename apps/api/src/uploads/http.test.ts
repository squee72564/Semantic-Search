import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { DocumentRepository, JobRepository, UnitOfWork, WorkspaceRepository } from "@repo/db";
import { apiEnvSchema } from "@repo/env/api";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachment,
  document,
  job,
  multipartBody,
  uploadRequest,
  userId,
  workspace,
  workspaceId,
} from "../../test/upload-fixtures.js";
import { createAuthenticationMiddleware } from "../lib/auth.js";
import type { AppVariables } from "../lib/context.js";
import { createLogger } from "../lib/logger.js";
import { createErrorHandler } from "../http/error-handler.js";
import { createCsrfProtection, createSecurityMiddleware } from "../middleware/security.js";
import { createRequestIdMiddleware } from "../middleware/request-id.js";
import { createWorkspaceDocumentRoutes } from "../routes/v1/document.js";
import { createUploadService } from "./service.js";
import { uploadError } from "./errors.js";

describe("authenticated upload HTTP flow", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "upload-http-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function setup({
    authenticated = true,
    reused = false,
    owned = true,
    maxFileBytes = 2 * 1024 ** 2,
  } = {}) {
    const documents: DocumentRepository = {
      create: vi.fn<DocumentRepository["create"]>().mockResolvedValue(document),
      createOrFind: vi
        .fn<DocumentRepository["createOrFind"]>()
        .mockResolvedValue({ document, created: !reused }),
      findBySha256: vi
        .fn<DocumentRepository["findBySha256"]>()
        .mockResolvedValue(reused ? document : null),
      findById: vi.fn<DocumentRepository["findById"]>().mockResolvedValue(document),
      attach: vi.fn<DocumentRepository["attach"]>().mockResolvedValue(attachment),
      detach: vi.fn<DocumentRepository["detach"]>().mockResolvedValue(true),
      list: vi.fn<DocumentRepository["list"]>().mockResolvedValue({ items: [], nextCursor: null }),
      listWorkspaceDocuments: vi
        .fn<DocumentRepository["listWorkspaceDocuments"]>()
        .mockResolvedValue({ items: [], nextCursor: null }),
      markDeletingIfUnattached: vi
        .fn<DocumentRepository["markDeletingIfUnattached"]>()
        .mockResolvedValue(null),
      updateAttachment: vi.fn<DocumentRepository["updateAttachment"]>().mockResolvedValue(null),
      updateMetadata: vi.fn<DocumentRepository["updateMetadata"]>().mockResolvedValue(null),
    };
    const workspaces: WorkspaceRepository = {
      create: vi.fn<WorkspaceRepository["create"]>().mockResolvedValue(workspace),
      findById: vi
        .fn<WorkspaceRepository["findById"]>()
        .mockResolvedValue(owned ? workspace : null),
      delete: vi.fn<WorkspaceRepository["delete"]>().mockResolvedValue(false),
      update: vi.fn<WorkspaceRepository["update"]>().mockResolvedValue(null),
      list: vi.fn<WorkspaceRepository["list"]>().mockResolvedValue({ items: [], nextCursor: null }),
    };
    const jobs: Pick<JobRepository, "create" | "findActiveDocumentJob"> = {
      create: vi.fn<JobRepository["create"]>().mockResolvedValue({ job, created: true }),
      findActiveDocumentJob: vi.fn<JobRepository["findActiveDocumentJob"]>().mockResolvedValue(job),
    };
    const repositories = { documents, workspaces, jobs };
    const persistence: UnitOfWork<typeof repositories> = {
      repositories,
      transaction: (operation) => operation(repositories),
    };
    const logger = createLogger("test");
    logger.level = "silent";
    const env = apiEnvSchema.parse({
      DATABASE_URL: "postgres://localhost/test",
      BETTER_AUTH_SECRET: "x".repeat(32),
      NODE_ENV: "test",
      S3_ACCESS_KEY_ID: "test",
      S3_SECRET_ACCESS_KEY: "test",
      S3_BUCKET: "test-bucket",
      S3_REGION: "test",
      S3_ENDPOINT: "http://localhost",
    });
    let stored: {
      key: string;
      size: number;
      sha256: string;
      contentType: string;
      metadata: Record<string, string>;
    } | null = null;
    const validatePdf = vi.fn<() => Promise<void>>(async () => {});
    const execute = createUploadService({
      persistence,
      logger,
      validatePdf,
      storage: {
        put: async (input) => {
          if (input.body instanceof Readable)
            for await (const chunk of input.body) {
              void chunk;
            }
          stored = {
            key: input.key,
            size: input.size,
            sha256: input.sha256,
            contentType: input.contentType,
            metadata: {},
          };
          return stored;
        },
        head: async () => stored,
      },
    });
    const { requireAuth } = createAuthenticationMiddleware({
      auth: {
        handler: () => new Response(),
        api: {
          getSession: async () =>
            authenticated
              ? {
                  user: {
                    id: userId,
                    name: "Test",
                    email: "test@example.invalid",
                    emailVerified: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                  },
                  session: {
                    id: "test-session",
                    userId,
                    token: "test-token",
                    expiresAt: new Date(Date.now() + 100000),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                  },
                }
              : null,
        },
      },
    });
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", createRequestIdMiddleware());
    app.use("*", ...createSecurityMiddleware(env));
    app.use("*", createCsrfProtection(env));
    app.route(
      "/workspaces/:workspaceId/documents",
      createWorkspaceDocumentRoutes(documents, workspaces, requireAuth(), {
        execute,
        limits: {
          temporaryRoot: root,
          maxFileBytes,
          maxMetadataBytes: 65536,
          maxOverheadBytes: 1024 ** 2,
        },
      }),
    );
    app.onError(createErrorHandler(env, logger));
    return { app, validatePdf, documents };
  }

  it.each([false, true])(
    "returns the public response after publication (reuse=%s)",
    async (reused) => {
      const { app } = setup({ reused });
      const response = await app.fetch(
        uploadRequest(multipartBody("%PDF-1.7\nexample", '{"title":"A PDF"}')),
      );
      expect(response.status).toBe(reused ? 200 : 201);
      const body = await response.json();
      expect(body).toMatchObject({
        reused,
        jobId: job.id,
        document: { id: document.id },
        attachment: { workspaceId },
      });
      expect(body).not.toHaveProperty("document.originalObjectKey");
      expect(body).not.toHaveProperty("document.userId");
      expect(await readdir(root)).toEqual([]);
    },
  );

  it.each([
    [false, true, 401],
    [true, false, 404],
  ] as const)(
    "rejects auth=%s ownership=%s before reading the upload",
    async (authenticated, owned, status) => {
      const request = uploadRequest();
      const response = await setup({ authenticated, owned }).app.fetch(request);
      expect(response.status).toBe(status);
      expect(request.bodyUsed).toBe(false);
      expect(await readdir(root)).toEqual([]);
    },
  );

  it("rejects cross-site multipart requests before reading bytes", async () => {
    const request = uploadRequest();
    request.headers.set("sec-fetch-site", "cross-site");
    expect((await setup().app.fetch(request)).status).toBe(403);
    expect(request.bodyUsed).toBe(false);
  });

  it("streams an upload above the standard 1 MiB limit without Content-Length", async () => {
    const response = await setup().app.fetch(
      uploadRequest(multipartBody(Buffer.alloc(1024 ** 2 + 1))),
    );
    expect(response.status).toBe(201);
    expect(await readdir(root)).toEqual([]);
  });

  it.each([undefined, "1"])(
    "rejects oversized uploads with declared size %s",
    async (contentLength) => {
      const response = await setup({ maxFileBytes: 10 }).app.fetch(
        uploadRequest(
          multipartBody(Buffer.alloc(11)),
          contentLength === undefined ? {} : { contentLength },
        ),
      );
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ status: 413, code: "UPLOAD_TOO_LARGE" });
      expect(await readdir(root)).toEqual([]);
    },
  );

  it("preserves the standard limit on non-upload routes", async () => {
    const response = await setup().app.request(
      `/workspaces/${workspaceId}/documents/${document.id}`,
      {
        method: "PUT",
        body: "x".repeat(1024 ** 2 + 1),
        headers: { "content-type": "application/json" },
      },
    );
    expect(response.status).toBe(413);
  });

  it("maps invalid PDF validation to problem details and cleans up", async () => {
    const h = setup();
    h.validatePdf.mockRejectedValue(uploadError(422, "INVALID_PDF", "Invalid PDF."));
    const response = await h.app.fetch(uploadRequest());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "INVALID_PDF",
      requestId: expect.any(String),
    });
    expect(h.documents.createOrFind).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });
});
