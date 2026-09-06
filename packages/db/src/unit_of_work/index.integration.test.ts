import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseExecutor } from "../client.js";
import { user } from "../schema/auth.js";
import { documents } from "../schema/documents.js";
import { jobs } from "../schema/jobs.js";
import { workspaceDocuments } from "../schema/workspace-documents.js";
import { workspaces } from "../schema/workspaces.js";
import { createDocumentRepository, DocumentDeletingError } from "../repositories/documents.js";
import { createJobRepository } from "../repositories/jobs.js";
import { createWorkspaceRepository } from "../repositories/workspaces.js";
import { createUnitOfWork } from "./index.js";
import { createScopedPersistence, PersistenceUnavailableError } from "./scoped.js";

const factory = (executor: DatabaseExecutor) => ({
  documents: createDocumentRepository(executor),
  jobs: createJobRepository(executor),
  workspaces: createWorkspaceRepository(executor),
  backendId: async () => {
    const [row] = await executor.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    if (!row) throw new Error("Backend PID missing");
    return row.pid;
  },
  sleep: (milliseconds: number) => executor.execute(sql`select pg_sleep(${milliseconds} / 1000.0)`),
  lock: (key: string) => executor.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`),
});
const input = () => {
  const id = randomUUID();
  return {
    id,
    originalObjectKey: `upload-test/${id}/original.pdf`,
    originalFilename: "source.pdf",
    originalSizeBytes: 100,
    originalContentType: "application/pdf",
    sha256: "a".repeat(64),
  };
};

const operationOptions = () => ({
  signal: new AbortController().signal,
  deadline: Date.now() + 5_000,
});

describe.runIf(process.env.DOCUMENT_UPLOAD_INTEGRATION_TESTS === "true")(
  "PostgreSQL upload unit of work",
  () => {
    let database: ReturnType<typeof createDatabase>;
    let owner: string;
    let workspaceId: string;
    const inFlight: Promise<unknown>[] = [];
    const pools: { close(): Promise<void> }[] = [];
    function scoped(
      overrides: {
        statementTimeoutMs?: number;
        lockTimeoutMs?: number;
        phaseTimeoutMs?: number;
        settlementTimeoutMs?: number;
      } = {},
    ) {
      const databaseUrl = process.env.DOCUMENT_UPLOAD_TEST_DATABASE_URL;
      if (!databaseUrl) throw new Error("Test database URL required");
      const pool = createScopedPersistence(databaseUrl, factory, {
        max: 1,
        statementTimeoutMs: 1_000,
        lockTimeoutMs: 200,
        phaseTimeoutMs: 3_000,
        ...overrides,
      });
      pools.push(pool);
      return pool;
    }
    beforeEach(async () => {
      if (
        process.env.DOCUMENT_UPLOAD_TEST_NON_PRODUCTION !== "true" ||
        !process.env.DOCUMENT_UPLOAD_TEST_DATABASE_URL
      ) {
        throw new Error(
          "Set DOCUMENT_UPLOAD_TEST_NON_PRODUCTION=true and DOCUMENT_UPLOAD_TEST_DATABASE_URL to a dedicated migrated test database",
        );
      }
      database = createDatabase(process.env.DOCUMENT_UPLOAD_TEST_DATABASE_URL);
      owner = `upload-test-${randomUUID()}`;
      await database.db.insert(user).values({
        id: owner,
        name: "Upload integration",
        email: `${owner}@example.invalid`,
        emailVerified: true,
      });
      workspaceId = (
        await createWorkspaceRepository(database.db).create(owner, { name: "Upload test" })
      ).id;
    });
    afterEach(async () => {
      if (!database) return;
      try {
        await Promise.allSettled(inFlight.splice(0));
        await Promise.all(pools.splice(0).map((pool) => pool.close()));
        if (owner) {
          await database.db.delete(workspaceDocuments).where(eq(workspaceDocuments.userId, owner));
          await database.db.delete(jobs).where(eq(jobs.userId, owner));
          await database.db.delete(documents).where(eq(documents.userId, owner));
          await database.db.delete(workspaces).where(eq(workspaces.userId, owner));
          await database.db.delete(user).where(eq(user.id, owner));
        }
      } finally {
        await database.close();
      }
    });
    async function publish(repositories: ReturnType<typeof factory>) {
      const result = await repositories.documents.createOrFind(owner, input());
      const attachment = await repositories.documents.attach(
        owner,
        workspaceId,
        result.document.id,
      );
      if (!attachment) throw new Error("Attachment required");
      if (result.created)
        await repositories.jobs.create(owner, {
          kind: "document_processing",
          documentId: result.document.id,
          configurationSchemaVersion: 1,
          startStage: "preflight",
          maxAttempts: 3,
          idempotencyKey: `document:${result.document.id}:initial-processing`,
        });
      return result;
    }

    async function waitForBlock(blocked: number, blocker: number) {
      expect(blocked).not.toBe(blocker);
      await vi.waitFor(
        async () => {
          const [row] = await database.db.execute<{ blockers: number[] }>(
            sql`select pg_blocking_pids(${blocked}) as blockers`,
          );
          expect(row?.blockers).toContain(blocker);
        },
        { timeout: 2_000, interval: 10 },
      );
    }

    function compete<R>(operation: (repositories: ReturnType<typeof factory>) => Promise<R>) {
      const ready = Promise.withResolvers<number>();
      const result = createUnitOfWork(database.db, factory)
        .transaction(async (repositories) => {
          ready.resolve(await repositories.backendId());
          return operation(repositories);
        })
        .catch((error: unknown) => {
          ready.reject(error);
          throw error;
        });
      // Observe errors immediately while the blocking transaction is still open.
      void result.catch(() => {});
      inFlight.push(result);
      return { ready: ready.promise, result };
    }

    it("rolls back document, job, and attachment after a late failure across nested repository transactions", async () => {
      const uow = createUnitOfWork(database.db, factory);
      await expect(
        scoped().transaction(async (repositories) => {
          const created = await repositories.documents.createOrFind(owner, input());
          await repositories.documents.attach(owner, workspaceId, created.document.id);
          await repositories.jobs.create(owner, {
            kind: "document_processing",
            documentId: created.document.id,
            configurationSchemaVersion: 1,
            startStage: "preflight",
            maxAttempts: 3,
            idempotencyKey: "rollback",
          });
          expect(await uow.repositories.documents.findById(owner, created.document.id)).toBeNull();
          throw new Error("late failure");
        }, operationOptions()),
      ).rejects.toThrow("late failure");
      expect(await database.db.select().from(documents).where(eq(documents.userId, owner))).toEqual(
        [],
      );
      expect(await database.db.select().from(jobs).where(eq(jobs.userId, owner))).toEqual([]);
      expect(
        await database.db
          .select()
          .from(workspaceDocuments)
          .where(eq(workspaceDocuments.userId, owner)),
      ).toEqual([]);
    });

    it("converges concurrent duplicate publication on one document, attachment, and initial job", async () => {
      let competing: ReturnType<typeof compete<Awaited<ReturnType<typeof publish>>>> | undefined;
      const first = await createUnitOfWork(database.db, factory).transaction(
        async (repositories) => {
          const result = await publish(repositories);
          competing = compete(publish);
          await waitForBlock(await competing.ready, await repositories.backendId());
          return result;
        },
      );
      if (!competing) throw new Error("Competing publication not started");
      const results = [first, await competing.result] as const;
      expect(results[0].document.id).toBe(results[1].document.id);
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(
        await database.db.select().from(documents).where(eq(documents.userId, owner)),
      ).toHaveLength(1);
      expect(await database.db.select().from(jobs).where(eq(jobs.userId, owner))).toHaveLength(1);
      expect(
        await database.db
          .select()
          .from(workspaceDocuments)
          .where(eq(workspaceDocuments.userId, owner)),
      ).toHaveLength(1);
    });

    it("does not hide unrelated unique constraints or allow cross-user attachment", async () => {
      const repository = createDocumentRepository(database.db);
      const created = await repository.createOrFind(owner, input());
      await expect(
        repository.createOrFind(owner, {
          ...input(),
          originalObjectKey: created.document.originalObjectKey,
          sha256: "b".repeat(64),
        }),
      ).rejects.toThrow(/Failed query/iu);
      expect(await repository.attach("not-the-owner", workspaceId, created.document.id)).toBeNull();
    });

    it("checks attachments after waiting for the document lock before deletion", async () => {
      const repository = createDocumentRepository(database.db);
      const { document } = await repository.createOrFind(owner, input());
      let deletion: ReturnType<typeof compete> | undefined;
      await createUnitOfWork(database.db, factory).transaction(async (repositories) => {
        await repositories.documents.attach(owner, workspaceId, document.id);
        deletion = compete((other) => other.documents.markDeletingIfUnattached(owner, document.id));
        await waitForBlock(await deletion.ready, await repositories.backendId());
      });
      expect(await deletion?.result).toBeNull();
      expect(await repository.findById(owner, document.id)).toMatchObject({ status: "uploaded" });
      expect(
        (await repository.listWorkspaceDocuments({ userId: owner, workspaceId, limit: 10 })).items,
      ).toHaveLength(1);
    });

    it("rejects attachment after a competing deletion commits", async () => {
      const repository = createDocumentRepository(database.db);
      const { document } = await repository.createOrFind(owner, input());
      let attempted: ReturnType<typeof compete> | undefined;
      await createUnitOfWork(database.db, factory).transaction(async (repositories) => {
        await repositories.documents.markDeletingIfUnattached(owner, document.id);
        attempted = compete((other) => other.documents.attach(owner, workspaceId, document.id));
        await waitForBlock(await attempted.ready, await repositories.backendId());
      });
      await expect(attempted?.result).rejects.toBeInstanceOf(DocumentDeletingError);
      expect(
        (await repository.listWorkspaceDocuments({ userId: owner, workspaceId, limit: 10 })).items,
      ).toHaveLength(0);
    });

    it("bounds statement execution and reuses the connection after rollback", async () => {
      const pool = scoped({ statementTimeoutMs: 50 });
      const pid = await pool.read((repositories) => repositories.backendId(), operationOptions());
      await expect(
        pool.transaction(async (repositories) => {
          await repositories.workspaces.create(owner, { name: "must roll back" });
          await repositories.sleep(1_000);
        }, operationOptions()),
      ).rejects.toBeInstanceOf(PersistenceUnavailableError);
      expect(await pool.read((repositories) => repositories.backendId(), operationOptions())).toBe(
        pid,
      );
      const rows = await database.db.select().from(workspaces).where(eq(workspaces.userId, owner));
      expect(rows).toHaveLength(1);
    });

    it("bounds lock waits without losing the reusable client", async () => {
      const pool = scoped({ lockTimeoutMs: 50 });
      const pid = await pool.read((repositories) => repositories.backendId(), operationOptions());
      await createUnitOfWork(database.db, factory).transaction(async (repositories) => {
        await repositories.lock(workspaceId);
        await expect(
          pool.transaction((other) => other.lock(workspaceId), operationOptions()),
        ).rejects.toBeInstanceOf(PersistenceUnavailableError);
      });
      expect(await pool.read((repositories) => repositories.backendId(), operationOptions())).toBe(
        pid,
      );
    });

    it("terminates an unsettled database phase, rolls back writes, and replaces the client", async () => {
      const pool = scoped({
        statementTimeoutMs: 10_000,
        phaseTimeoutMs: 100,
        settlementTimeoutMs: 20,
      });
      const pid = await pool.read((repositories) => repositories.backendId(), operationOptions());
      const startedAt = performance.now();
      await expect(
        pool.transaction(async (repositories) => {
          await repositories.workspaces.create(owner, { name: "terminated" });
          await repositories.sleep(2_000);
        }, operationOptions()),
      ).rejects.toBeInstanceOf(PersistenceUnavailableError);
      expect(performance.now() - startedAt).toBeLessThan(1_500);
      expect(
        await pool.read((repositories) => repositories.backendId(), operationOptions()),
      ).not.toBe(pid);
      expect(
        await database.db.select().from(workspaces).where(eq(workspaces.userId, owner)),
      ).toHaveLength(1);
    });

    it("rolls back cancellation after writes and before commit", async () => {
      const pool = scoped();
      const controller = new AbortController();
      await expect(
        pool.transaction(
          async (repositories) => {
            await repositories.workspaces.create(owner, { name: "cancelled" });
            controller.abort();
          },
          { ...operationOptions(), signal: controller.signal },
        ),
      ).rejects.toBeInstanceOf(PersistenceUnavailableError);
      expect(
        await database.db.select().from(workspaces).where(eq(workspaces.userId, owner)),
      ).toHaveLength(1);
    });
  },
);
