import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const factory = (executor: DatabaseExecutor) => ({
  documents: createDocumentRepository(executor),
  jobs: createJobRepository(executor),
  workspaces: createWorkspaceRepository(executor),
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

describe.runIf(process.env.DOCUMENT_UPLOAD_INTEGRATION_TESTS === "true")(
  "PostgreSQL upload unit of work",
  () => {
    let database: ReturnType<typeof createDatabase>;
    let owner: string;
    let workspaceId: string;
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
      await database.db
        .insert(user)
        .values({
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
    function publish() {
      return createUnitOfWork(database.db, factory).transaction(async (repositories) => {
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
      });
    }

    it("rolls back document, job, and attachment after a late failure across nested repository transactions", async () => {
      const uow = createUnitOfWork(database.db, factory);
      await expect(
        uow.transaction(async (repositories) => {
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
        }),
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
      const results = await Promise.all([publish(), publish()]);
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
      let deletion: Promise<unknown> | undefined;
      await createUnitOfWork(database.db, factory).transaction(async (repositories) => {
        await repositories.documents.attach(owner, workspaceId, document.id);
        deletion = repository.markDeletingIfUnattached(owner, document.id);
      });
      expect(await deletion).toBeNull();
      expect(await repository.findById(owner, document.id)).toMatchObject({ status: "uploaded" });
      expect(
        (await repository.listWorkspaceDocuments({ userId: owner, workspaceId, limit: 10 })).items,
      ).toHaveLength(1);
    });

    it("rejects attachment after a competing deletion commits", async () => {
      const repository = createDocumentRepository(database.db);
      const { document } = await repository.createOrFind(owner, input());
      let attempted: Promise<unknown> | undefined;
      await createUnitOfWork(database.db, factory).transaction(async (repositories) => {
        await repositories.documents.markDeletingIfUnattached(owner, document.id);
        attempted = repository
          .attach(owner, workspaceId, document.id)
          .catch((error: unknown) => error);
      });
      expect(await attempted).toBeInstanceOf(DocumentDeletingError);
      expect(
        (await repository.listWorkspaceDocuments({ userId: owner, workspaceId, limit: 10 })).items,
      ).toHaveLength(0);
    });
  },
);
