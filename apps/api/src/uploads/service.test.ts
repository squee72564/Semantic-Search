import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { DocumentRepository, JobRepository, WorkspaceRepository, UnitOfWork } from "@repo/db";
import { DocumentDeletingError } from "@repo/db";
import type { ObjectStorage } from "@repo/object-storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachment,
  document,
  job,
  userId,
  workspace,
  workspaceId,
} from "../../test/upload-fixtures.js";
import { createUploadService, type UploadInput } from "./service.js";
import type { Logger } from "../lib/logger.js";

describe("document upload application service", () => {
  let directory: string;
  let path: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "upload-service-test-"));
    path = join(directory, "original.pdf");
    await writeFile(path, "%PDF-1.7\nexample");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function setup(options: { timeoutMs?: number; maxConcurrent?: number } = {}) {
    const repositories = {
      documents: {
        findBySha256: vi.fn<DocumentRepository["findBySha256"]>().mockResolvedValue(null),
        findById: vi.fn<DocumentRepository["findById"]>().mockResolvedValue(document),
        createOrFind: vi.fn<DocumentRepository["createOrFind"]>(async (owner, input) => ({
          document: {
            ...document,
            ...input,
            userId: owner,
            title: input.title ?? null,
            description: input.description ?? null,
            customMetadata: input.customMetadata ?? {},
          },
          created: true,
        })),
        attach: vi.fn<DocumentRepository["attach"]>(async (owner, targetWorkspace, documentId) => ({
          ...attachment,
          userId: owner,
          workspaceId: targetWorkspace,
          documentId,
        })),
      },
      workspaces: {
        findById: vi.fn<WorkspaceRepository["findById"]>().mockResolvedValue(workspace),
      },
      jobs: {
        create: vi.fn<JobRepository["create"]>(async (owner, input) => ({
          created: true,
          job: { ...job, userId: owner, documentId: input.documentId ?? null },
        })),
        findActiveDocumentJob: vi
          .fn<JobRepository["findActiveDocumentJob"]>()
          .mockResolvedValue(job),
      },
    };
    type Repositories = typeof repositories;
    let inTransaction = false;
    const transaction = vi.fn<UnitOfWork<Repositories>["transaction"]>(
      async <T>(operation: (repositories: Repositories) => Promise<T>) => {
        inTransaction = true;
        try {
          return await operation(repositories);
        } finally {
          inTransaction = false;
        }
      },
    );
    const storage = {
      put: vi.fn<ObjectStorage["put"]>(async (input) => {
        expect(inTransaction).toBe(false);
        if (input.body instanceof Readable)
          for await (const chunk of input.body) {
            void chunk;
          }
        return {
          key: input.key,
          sha256: input.sha256,
          size: input.size,
          contentType: input.contentType,
          metadata: {},
        };
      }),
      head: vi.fn<ObjectStorage["head"]>(async (key) => ({
        key,
        sha256: document.sha256,
        size: document.originalSizeBytes,
        contentType: "application/pdf",
        metadata: {},
      })),
    };
    const cleanup = vi.fn<() => Promise<void>>(async () => {
      await rm(directory, { recursive: true, force: true });
    });
    const input: UploadInput = {
      userId,
      workspaceId,
      requestId: "request-test",
      signal: new AbortController().signal,
      prepare: vi.fn<UploadInput["prepare"]>(async () => ({
        path,
        filename: "source.pdf",
        sha256: document.sha256,
        size: document.originalSizeBytes,
        metadata: { title: "Uploaded", tags: ["tax"] },
        cleanup,
      })),
    };
    const logger = { warn: vi.fn<Logger["warn"]>(), error: vi.fn<Logger["error"]>() };
    const validatePdf = vi.fn<() => Promise<void>>(async () => {});
    const execute = createUploadService({
      persistence: {
        repositories,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Vitest erases generic callback return types; this mock returns the operation's result.
        transaction: transaction as UnitOfWork<Repositories>["transaction"],
      },
      storage,
      validatePdf,
      logger,
      ...options,
    });
    return { execute, input, repositories, transaction, storage, cleanup, logger, validatePdf };
  }

  it("verifies storage before committing all database writes and returns the new document", async () => {
    const h = setup();
    const result = await h.execute(h.input);
    expect(result.reused).toBe(false);
    expect(result.attachment.documentId).toBe(result.document.id);
    expect(h.storage.put).toHaveBeenCalledOnce();
    expect(h.storage.head.mock.invocationCallOrder[0]).toBeLessThan(
      h.transaction.mock.invocationCallOrder[0]!,
    );
    expect(h.repositories.jobs.create).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        documentId: result.document.id,
        startStage: "preflight",
        maxAttempts: 3,
        configurationSchemaVersion: 1,
      }),
    );
    expect(h.repositories.workspaces.findById).toHaveBeenCalledTimes(2);
    expect(h.cleanup).toHaveBeenCalledOnce();
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it.each(["uploaded", "processing", "ready", "failed"] as const)(
    "reuses %s documents without re-uploading or restarting processing",
    async (status) => {
      const h = setup();
      h.repositories.documents.findBySha256.mockResolvedValue({ ...document, status });
      h.repositories.documents.findById.mockResolvedValue({ ...document, status });
      h.repositories.jobs.findActiveDocumentJob.mockResolvedValue(null);
      expect(await h.execute(h.input)).toMatchObject({
        reused: true,
        jobId: null,
        document: { status, title: null },
      });
      expect(h.storage.put).not.toHaveBeenCalled();
      expect(h.repositories.jobs.create).not.toHaveBeenCalled();
      expect(h.repositories.documents.attach).toHaveBeenCalledWith(
        userId,
        workspaceId,
        document.id,
        { displayTitle: undefined, tags: ["tax"] },
      );
    },
  );

  it("reuses the winner of a concurrent insert and records the redundant object for reconciliation", async () => {
    const h = setup();
    h.repositories.documents.createOrFind.mockResolvedValue({ document, created: false });
    expect(await h.execute(h.input)).toMatchObject({ document, reused: true, jobId: job.id });
    expect(h.repositories.jobs.create).not.toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "request-test", stage: "duplicate" }),
      expect.any(String),
    );
  });

  it("does not consume an upload for an unavailable or other-user workspace", async () => {
    const h = setup();
    h.repositories.workspaces.findById.mockResolvedValue(null);
    await expect(h.execute(h.input)).rejects.toMatchObject({ status: 404 });
    expect(h.input.prepare).not.toHaveBeenCalled();
    expect(h.repositories.workspaces.findById).toHaveBeenCalledWith(userId, workspaceId);
  });

  it("uses the authenticated owner for checksum lookups and every mutation", async () => {
    const h = setup();
    await h.execute({ ...h.input, userId: "second-user" });
    expect(h.repositories.documents.findBySha256).toHaveBeenCalledWith(
      "second-user",
      document.sha256,
    );
    expect(h.repositories.documents.createOrFind).toHaveBeenCalledWith(
      "second-user",
      expect.any(Object),
    );
    expect(h.repositories.jobs.create).toHaveBeenCalledWith("second-user", expect.any(Object));
  });

  it.each(["lookup", "attach"])("rejects deleting documents discovered at %s", async (stage) => {
    const h = setup();
    if (stage === "lookup")
      h.repositories.documents.findBySha256.mockResolvedValue({ ...document, status: "deleting" });
    else h.repositories.documents.attach.mockRejectedValue(new DocumentDeletingError());
    await expect(h.execute(h.input)).rejects.toMatchObject({ status: 409 });
    expect(h.repositories.jobs.create).not.toHaveBeenCalled();
    expect(h.cleanup).toHaveBeenCalledOnce();
  });

  it.each(["put", "head", "attachment", "job", "workspace"])(
    "fails safely at %s and retains uncertain storage for reconciliation",
    async (stage) => {
      const h = setup();
      if (stage === "put") h.storage.put.mockRejectedValue(new Error("connection lost"));
      if (stage === "head") h.storage.head.mockResolvedValue(null);
      if (stage === "attachment") h.repositories.documents.attach.mockResolvedValue(null);
      if (stage === "job")
        h.repositories.jobs.create.mockRejectedValue(new Error("database failure"));
      if (stage === "workspace")
        h.repositories.workspaces.findById.mockResolvedValueOnce(workspace).mockResolvedValue(null);
      await expect(h.execute(h.input)).rejects.toBeInstanceOf(Error);
      expect(h.transaction).toHaveBeenCalledTimes(stage === "head" || stage === "put" ? 0 : 1);
      expect(h.cleanup).toHaveBeenCalledOnce();
      expect(h.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "request-test", objectKey: expect.any(String) }),
        expect.any(String),
      );
    },
  );

  it.each(["size", "sha256", "contentType"])("rejects a HEAD %s mismatch", async (field) => {
    const h = setup();
    h.storage.head.mockResolvedValue({
      key: "key",
      size: document.originalSizeBytes,
      sha256: document.sha256,
      contentType: "application/pdf",
      metadata: {},
      [field]: field === "size" ? 999 : "wrong",
    });
    await expect(h.execute(h.input)).rejects.toMatchObject({ status: 503 });
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("rejects a reused job linked to a different document", async () => {
    const h = setup();
    h.repositories.jobs.create.mockResolvedValue({
      created: false,
      job: { ...job, documentId: "other" },
    });
    await expect(h.execute(h.input)).rejects.toThrow("does not match");
    await expect(h.transaction.mock.results[0]?.value).rejects.toThrow("does not match");
  });

  it("does not respond before commit completes", async () => {
    const h = setup();
    let commit: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      commit = resolve;
    });
    h.transaction.mockImplementation(async (operation) => {
      const result = await operation(h.repositories);
      await gate;
      return result;
    });
    let returned = false;
    const pending = h.execute(h.input).then((value) => {
      returned = true;
      return value;
    });
    await vi.waitFor(() => expect(h.repositories.jobs.create).toHaveBeenCalledOnce());
    expect(returned).toBe(false);
    commit!();
    await pending;
  });

  it("retains the uploaded object after an uncertain commit outcome", async () => {
    const h = setup();
    h.transaction.mockImplementation(async (operation) => {
      await operation(h.repositories);
      throw new Error("connection lost during commit");
    });
    await expect(h.execute(h.input)).rejects.toThrow("connection lost during commit");
    expect(h.repositories.jobs.create).toHaveBeenCalledOnce();
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "transaction", objectKey: expect.any(String) }),
      expect.any(String),
    );
    expect(h.cleanup).toHaveBeenCalledOnce();
  });

  it("bounds concurrency, aborts preparation on deadline, and releases the slot", async () => {
    const h = setup({ maxConcurrent: 1, timeoutMs: 30 });
    h.input.prepare = (signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
    const first = h.execute(h.input).catch((error: unknown) => error);
    await expect(h.execute(h.input)).rejects.toMatchObject({ status: 503 });
    await expect(first).resolves.toMatchObject({ status: 408 });
    h.repositories.workspaces.findById.mockResolvedValue(null);
    await expect(h.execute(h.input)).rejects.toMatchObject({ status: 404 });
  });

  it("cleans files after PDF validation fails, before any storage write", async () => {
    const h = setup();
    h.validatePdf.mockRejectedValue(new Error("invalid PDF"));
    await expect(h.execute(h.input)).rejects.toThrow("invalid PDF");
    expect(h.storage.put).not.toHaveBeenCalled();
    expect(h.cleanup).toHaveBeenCalledOnce();
  });
});
