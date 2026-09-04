import { drizzle } from "drizzle-orm/postgres-js";
import { describe, expect, it } from "vitest";

import * as schema from "../schema/index.js";
import { createDocumentRepository } from "./documents.js";

interface CapturedQuery {
  parameters: readonly unknown[];
  sql: string;
}

const createdAt = new Date("2026-08-30T12:00:00.000Z");
const updatedAt = new Date("2026-08-30T13:00:00.000Z");
const attachedAt = new Date("2026-08-30T12:30:00.000Z");
const userId = "user-1";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const secondWorkspaceId = "00000000-0000-4000-8000-000000000002";
const documentId = "00000000-0000-4000-8000-000000000003";
const sha256 = "a".repeat(64);

function documentRow({
  id = documentId,
  ownerId = userId,
}: {
  id?: string;
  ownerId?: string;
} = {}): unknown[] {
  return [
    id,
    ownerId,
    sha256,
    "source.pdf",
    "Source",
    "Canonical description",
    {},
    `users/${ownerId}/documents/${id}/original.pdf`,
    1024,
    "application/pdf",
    null,
    "uploaded",
    createdAt,
    updatedAt,
  ];
}

function attachmentRow({
  tags = ["tax"],
  targetDocumentId = documentId,
  targetWorkspaceId = workspaceId,
}: {
  tags?: string[];
  targetDocumentId?: string;
  targetWorkspaceId?: string;
} = {}): unknown[] {
  return [
    userId,
    targetWorkspaceId,
    targetDocumentId,
    "Workspace source",
    tags,
    attachedAt,
    updatedAt,
  ];
}

function createRecordingDatabase(responses: unknown[][][]) {
  const queries: CapturedQuery[] = [];
  const client: {
    begin: <T>(callback: (transactionClient: typeof client) => Promise<T>) => Promise<T>;
    options: { parsers: Record<string, never>; serializers: Record<string, never> };
    savepoint: <T>(callback: (transactionClient: typeof client) => Promise<T>) => Promise<T>;
    unsafe: (sql: string, parameters: readonly unknown[]) => { values: () => Promise<unknown[][]> };
  } = {
    begin: (callback) => callback(client),
    savepoint: (callback) => callback(client),
    options: { parsers: {}, serializers: {} },
    unsafe(sql: string, parameters: readonly unknown[]) {
      queries.push({ parameters, sql });
      const response = responses.shift() ?? [];

      return {
        values: () => Promise.resolve(response),
      };
    },
  };
  // @ts-expect-error The recording client intentionally implements only the postgres-js methods used here.
  const db = drizzle(client, { schema });

  return { db, queries };
}

describe("Document repository", () => {
  it("resolves only checksum conflicts and locks the existing document", async () => {
    const { db, queries } = createRecordingDatabase([[], [documentRow()]]);
    const repository = createDocumentRepository(db);
    await expect(
      repository.createOrFind(userId, {
        id: documentId,
        originalObjectKey: "original.pdf",
        originalFilename: "source.pdf",
        originalContentType: "application/pdf",
        originalSizeBytes: 1024,
        sha256,
      }),
    ).resolves.toMatchObject({ created: false, document: { id: documentId, userId } });
    expect(queries[0]?.sql).toContain('on conflict ("user_id","sha256") do nothing');
    expect(queries[1]?.sql).toContain("for update");
  });

  it("refuses attaching a deleting document before the attachment insert", async () => {
    const { db, queries } = createRecordingDatabase([[[documentId, "deleting"]]]);
    await expect(
      createDocumentRepository(db).attach(userId, workspaceId, documentId),
    ).rejects.toThrow("being deleted");
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toContain("for update");
  });

  it("creates and finds a canonical document within the authenticated user boundary", async () => {
    const { db, queries } = createRecordingDatabase([[documentRow()], [documentRow()]]);
    const repository = createDocumentRepository(db);

    await expect(
      repository.create(userId, {
        description: "Canonical description",
        id: documentId,
        originalContentType: "application/pdf",
        originalFilename: "source.pdf",
        originalObjectKey: `users/${userId}/documents/${documentId}/original.pdf`,
        originalSizeBytes: 1024,
        sha256,
        title: "Source",
      }),
    ).resolves.toMatchObject({ id: documentId, status: "uploaded", userId });
    await expect(repository.findBySha256(userId, sha256)).resolves.toMatchObject({
      id: documentId,
      title: "Source",
      userId,
    });

    expect(queries[0]?.sql).toContain('insert into "documents"');
    expect(queries[1]?.sql).toContain('"documents"."user_id"');
    expect(queries[1]?.sql).toContain('"documents"."sha256"');
    expect(queries[1]?.parameters).toContain(userId);
    expect(queries[1]?.parameters).toContain(sha256);
  });

  it("filters the canonical library through contextual attachments without joining duplicate rows", async () => {
    const { db, queries } = createRecordingDatabase([[documentRow()]]);
    const repository = createDocumentRepository(db);

    await expect(
      repository.list({
        limit: 10,
        status: "uploaded",
        tags: [" Tax ", "REFERENCE"],
        userId,
        workspaceId,
      }),
    ).resolves.toMatchObject({ nextCursor: null, items: [{ id: documentId }] });

    expect(queries[0]?.sql).toContain('from "documents"');
    expect(queries[0]?.sql).toContain("exists (select");
    expect(queries[0]?.sql).toContain('"workspace_documents"."tags" @>');
    expect(queries[0]?.sql).not.toContain('join "workspace_documents"');
    expect(queries[0]?.parameters).toContain(userId);
    expect(queries[0]?.parameters).toContain(workspaceId);
    expect(queries[0]?.parameters).toContain('{"tax","reference"}');
  });

  it("returns the raw cursor for the last visible document", async () => {
    const secondId = "00000000-0000-4000-8000-000000000004";
    const thirdId = "00000000-0000-4000-8000-000000000005";
    const cursorId = "00000000-0000-4000-8000-000000000006";
    const { db, queries } = createRecordingDatabase([
      [documentRow(), documentRow({ id: secondId }), documentRow({ id: thirdId })],
    ]);
    const repository = createDocumentRepository(db);

    const page = await repository.list({
      cursor: { createdAt, id: cursorId },
      limit: 2,
      userId,
    });

    expect(page).toMatchObject({
      items: [{ id: documentId }, { id: secondId }],
      nextCursor: { createdAt, id: secondId },
    });
    expect(queries[0]?.sql).toContain(
      'order by "documents"."created_at" desc, "documents"."id" desc',
    );
    expect(queries[0]?.parameters).toContain(cursorId);
    expect(queries[0]?.parameters).toContain(3);
  });

  it("lists workspace documents with contextual attachment metadata", async () => {
    const secondId = "00000000-0000-4000-8000-000000000004";
    const { db, queries } = createRecordingDatabase([
      [
        [...attachmentRow({ tags: ["tax", "reference"] }), ...documentRow()],
        [
          ...attachmentRow({ tags: ["benefits"], targetDocumentId: secondId }),
          ...documentRow({ id: secondId }),
        ],
      ],
    ]);
    const repository = createDocumentRepository(db);

    await expect(
      repository.listWorkspaceDocuments({
        limit: 2,
        status: "uploaded",
        tags: [" Tax ", "REFERENCE"],
        userId,
        workspaceId,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          attachment: { tags: ["tax", "reference"], workspaceId },
          document: { id: documentId, userId },
        },
        {
          attachment: { tags: ["benefits"], workspaceId },
          document: { id: secondId, userId },
        },
      ],
      nextCursor: null,
    });

    expect(queries[0]?.sql).toContain('from "workspace_documents"');
    expect(queries[0]?.sql).toContain('inner join "documents"');
    expect(queries[0]?.sql).toContain('"workspace_documents"."tags" @>');
    expect(queries[0]?.sql).toContain(
      'order by "workspace_documents"."attached_at" desc, "workspace_documents"."document_id" desc',
    );
    expect(queries[0]?.parameters).toContain(userId);
    expect(queries[0]?.parameters).toContain(workspaceId);
    expect(queries[0]?.parameters).toContain('{"tax","reference"}');
  });

  it("returns an attachment cursor after slicing workspace document results", async () => {
    const secondId = "00000000-0000-4000-8000-000000000004";
    const thirdId = "00000000-0000-4000-8000-000000000005";
    const cursorId = "00000000-0000-4000-8000-000000000006";
    const { db, queries } = createRecordingDatabase([
      [
        [...attachmentRow(), ...documentRow()],
        [...attachmentRow({ targetDocumentId: secondId }), ...documentRow({ id: secondId })],
        [...attachmentRow({ targetDocumentId: thirdId }), ...documentRow({ id: thirdId })],
      ],
    ]);
    const repository = createDocumentRepository(db);

    const page = await repository.listWorkspaceDocuments({
      cursor: { attachedAt, id: cursorId },
      limit: 2,
      userId,
      workspaceId,
    });

    expect(page).toMatchObject({
      items: [{ document: { id: documentId } }, { document: { id: secondId } }],
      nextCursor: { attachedAt, id: secondId },
    });
    expect(queries[0]?.parameters).toContain(cursorId);
    expect(queries[0]?.parameters).toContain(3);
  });

  it("attaches one canonical document to multiple workspaces with independent tags", async () => {
    const { db, queries } = createRecordingDatabase([
      [[documentId]],
      [attachmentRow()],
      [[documentId]],
      [attachmentRow({ tags: ["benefits"], targetWorkspaceId: secondWorkspaceId })],
    ]);
    const repository = createDocumentRepository(db);

    await expect(
      repository.attach(userId, workspaceId, documentId, {
        displayTitle: "Workspace source",
        tags: [" Tax ", "tax"],
      }),
    ).resolves.toMatchObject({ tags: ["tax"], workspaceId });
    await expect(
      repository.attach(userId, secondWorkspaceId, documentId, {
        displayTitle: "Workspace source",
        tags: ["benefits"],
      }),
    ).resolves.toMatchObject({ tags: ["benefits"], workspaceId: secondWorkspaceId });

    const inserts = queries.filter((query) =>
      query.sql.includes('insert into "workspace_documents"'),
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.parameters).toContain('{"tax"}');
    expect(inserts[1]?.parameters).toContain('{"benefits"}');
  });

  it("returns the existing attachment when attach is repeated", async () => {
    const { db, queries } = createRecordingDatabase([[[documentId]], [], [attachmentRow()]]);
    const repository = createDocumentRepository(db);

    await expect(repository.attach(userId, workspaceId, documentId)).resolves.toMatchObject({
      documentId,
      workspaceId,
    });
    expect(queries[1]?.sql).toContain("on conflict");
    expect(queries[2]?.sql).toContain('from "workspace_documents"');
  });

  it("rejects a cross-user or missing workspace/document pair before attachment", async () => {
    const { db, queries } = createRecordingDatabase([[]]);
    const repository = createDocumentRepository(db);

    await expect(repository.attach("other-user", workspaceId, documentId)).resolves.toBeNull();
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toContain('inner join "workspaces"');
    expect(queries[0]?.parameters).toContain("other-user");
  });

  it("scopes attachment updates and detachment by user, workspace, and document", async () => {
    const { db, queries } = createRecordingDatabase([
      [attachmentRow({ tags: ["updated"] })],
      [[documentId]],
      [[documentId]],
    ]);
    const repository = createDocumentRepository(db);

    await expect(
      repository.updateAttachment(userId, workspaceId, documentId, {
        displayTitle: "Workspace source",
        tags: [" Updated "],
      }),
    ).resolves.toMatchObject({ tags: ["updated"] });
    await expect(repository.detach(userId, workspaceId, documentId)).resolves.toBe(true);

    for (const query of queries.filter((entry) => !entry.sql.includes("for update"))) {
      expect(query.parameters).toContain(userId);
      expect(query.parameters).toContain(workspaceId);
      expect(query.parameters).toContain(documentId);
    }
  });

  it("updates canonical and workspace display metadata independently", async () => {
    const { db, queries } = createRecordingDatabase([
      [documentRow()],
      [attachmentRow({ tags: ["context"] })],
    ]);
    const repository = createDocumentRepository(db);

    await repository.updateMetadata(userId, documentId, {
      description: "Shared source description",
      title: "Canonical title",
    });
    await repository.updateAttachment(userId, workspaceId, documentId, {
      displayTitle: "Contextual title",
      tags: ["context"],
    });

    expect(queries[0]?.sql).toContain('update "documents"');
    expect(queries[0]?.parameters).toContain("Canonical title");
    expect(queries[0]?.parameters).not.toContain("Contextual title");
    expect(queries[1]?.sql).toContain('update "workspace_documents"');
    expect(queries[1]?.parameters).toContain("Contextual title");
    expect(queries[1]?.parameters).not.toContain("Canonical title");
  });

  it("marks only unattached user-owned documents for deletion", async () => {
    const { db, queries } = createRecordingDatabase([[[documentId]], [documentRow()]]);
    const repository = createDocumentRepository(db);

    await expect(repository.markDeletingIfUnattached(userId, documentId)).resolves.toMatchObject({
      id: documentId,
    });
    expect(queries[0]?.sql).toContain("for update");
    expect(queries[1]?.sql).toContain('update "documents" set');
    expect(queries[1]?.sql).toContain("not exists (select");
    expect(queries[1]?.parameters).toContain("deleting");
    expect(queries[1]?.parameters).toContain(userId);
    expect(queries[1]?.parameters).toContain(documentId);
  });

  it("rejects invalid contextual tags before inserting an attachment", async () => {
    const { db, queries } = createRecordingDatabase([[[documentId]]]);
    const repository = createDocumentRepository(db);

    await expect(
      repository.attach(userId, workspaceId, documentId, { tags: [" "] }),
    ).rejects.toThrow("between 1 and 64 characters");
    expect(queries).toHaveLength(1);
  });
});
