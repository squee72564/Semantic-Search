import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  DocumentDeletingError,
  PersistenceUnavailableError,
  type DocumentRepository,
  type JobRepository,
  type ScopedPersistence,
  type WorkspaceRepository,
} from "@repo/db";
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
import { createAuthenticationMiddleware, type ApiAuthentication } from "../lib/auth.js";
import { createApp } from "../app.js";
import type { AppVariables } from "../lib/context.js";
import { createLogger } from "../lib/logger.js";
import { createErrorHandler } from "../http/error-handler.js";
import {
  createCsrfProtection,
  createSecurityHeaders,
  createRequestBodyLimit,
} from "../middleware/security.js";
import { createRequestIdMiddleware } from "../middleware/request-id.js";
import {
  createWorkspaceDocumentRoutes,
  createDocumentUploadRoutes,
} from "../routes/v1/document.js";
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
    const persistence: ScopedPersistence<typeof repositories> = {
      read: (operation, options) => operation(repositories, options.signal),
      transaction: (operation, options) => operation(repositories, options.signal),
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
    const auth: ApiAuthentication = {
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
    };
    const { requireAuth } = createAuthenticationMiddleware({ auth });
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", createRequestIdMiddleware());
    app.use("*", createSecurityHeaders(env));
    app.route(
      "/workspaces/:workspaceId/documents",
      createDocumentUploadRoutes(requireAuth(), createCsrfProtection(env), {
        execute,
        limits: {
          temporaryRoot: root,
          maxFileBytes,
          maxMetadataBytes: 65536,
          maxOverheadBytes: 1024 ** 2,
        },
      }),
    );
    app.use("*", createRequestBodyLimit(env));
    app.post("/api/auth/test", (context) => context.json({ ok: true }));
    app.use("*", createCsrfProtection(env));
    app.route(
      "/workspaces/:workspaceId/documents",
      createWorkspaceDocumentRoutes(documents, workspaces, requireAuth()),
    );
    app.onError(createErrorHandler(env, logger));
    const application = createApp({
      auth,
      documents,
      workspaces,
      env,
      logger,
      uploadDocument: execute,
    });
    return { app, application, validatePdf, documents, persistence };
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
      const response = await setup({ authenticated, owned }).application.fetch(request);
      expect(response.status).toBe(status);
      expect(request.bodyUsed).toBe(false);
      expect(await readdir(root)).toEqual([]);
    },
  );

  it("rejects cross-site multipart requests before reading bytes", async () => {
    const request = uploadRequest();
    request.headers.set("sec-fetch-site", "cross-site");
    expect((await setup().application.fetch(request)).status).toBe(403);
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

  it.each([
    ["/api/auth/test", "POST"],
    ["/unknown", "POST"],
    [`/workspaces/${workspaceId}/documents`, "PATCH"],
    [`/workspaces/${workspaceId}/documents/extra`, "POST"],
  ])("keeps the default body limit for %s %s", async (path, method) => {
    const response = await setup().application.request(path, {
      method,
      body: "x".repeat(1024 ** 2 + 1),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "REQUEST_BODY_TOO_LARGE" });
  });

  it("keeps Better Auth outside generic form CSRF", async () => {
    const response = await setup().application.request("/api/auth/test", {
      method: "POST",
      body: "form=value",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(response.status).toBe(200);
  });

  it.each(["upload", "attachment"])(
    "maps deleting documents consistently for %s",
    async (route) => {
      const h = setup();
      h.documents.attach = async () => {
        throw new DocumentDeletingError();
      };
      const response =
        route === "upload"
          ? await h.app.fetch(uploadRequest())
          : await h.app.request(`/workspaces/${workspaceId}/documents/${document.id}`, {
              method: "PUT",
              body: "{}",
              headers: { "content-type": "application/json" },
            });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "DOCUMENT_DELETING" });
      expect(await readdir(root)).toEqual([]);
    },
  );

  it("maps database timeout to a retryable service response", async () => {
    const h = setup();
    h.persistence.transaction = async () => {
      throw new PersistenceUnavailableError("transaction");
    };
    const response = await h.app.fetch(uploadRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UPLOAD_DATABASE_UNAVAILABLE" });
    expect(await readdir(root)).toEqual([]);
  });

  it("streams a large upload through the production application middleware", async () => {
    const h = setup();
    const response = await h.application.fetch(
      uploadRequest(multipartBody(Buffer.alloc(1024 ** 2 + 1))),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("preserves the request-aborted response", async () => {
    const request = new Request(uploadRequest(), { signal: AbortSignal.abort() });
    const response = await setup().application.fetch(request);
    expect(response.status).toBe(408);
    expect(await response.json()).toMatchObject({ code: "UPLOAD_ABORTED" });
    expect(request.bodyUsed).toBe(false);
  });
});
