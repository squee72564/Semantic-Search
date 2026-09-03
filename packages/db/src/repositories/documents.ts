import { and, arrayContains, desc, eq, exists, lt, notExists, or, sql } from "drizzle-orm";

import type { DatabaseExecutor } from "../client.js";
import { documents, type Document, type DocumentStatus } from "../schema/documents.js";
import { workspaceDocuments, type WorkspaceDocument } from "../schema/workspace-documents.js";
import { workspaces } from "../schema/workspaces.js";
import { createCursorPage, type CursorPage } from "./pagination.js";

export interface DocumentCursor {
  createdAt: Date;
  id: string;
}

export interface WorkspaceDocumentCursor {
  attachedAt: Date;
  id: string;
}

export interface CreateDocumentInput {
  customMetadata?: Record<string, unknown> | undefined;
  description?: string | null | undefined;
  id: string;
  originalContentType: string;
  originalFilename: string;
  originalObjectKey: string;
  originalSizeBytes: number;
  sha256: string;
  title?: string | null | undefined;
}

export interface UpdateDocumentMetadataInput {
  customMetadata?: Record<string, unknown> | undefined;
  description?: string | null | undefined;
  title?: string | null | undefined;
}

export interface ListDocumentsInput {
  cursor?: DocumentCursor | undefined;
  limit: number;
  status?: DocumentStatus | undefined;
  tags?: readonly string[] | undefined;
  userId: string;
  workspaceId?: string | undefined;
}

export type DocumentPage = CursorPage<Document, DocumentCursor>;

export interface WorkspaceDocumentListItem {
  attachment: WorkspaceDocument;
  document: Document;
}

export interface ListWorkspaceDocumentsInput {
  cursor?: WorkspaceDocumentCursor | undefined;
  limit: number;
  status?: DocumentStatus | undefined;
  tags?: readonly string[] | undefined;
  userId: string;
  workspaceId: string;
}

export type WorkspaceDocumentPage = CursorPage<WorkspaceDocumentListItem, WorkspaceDocumentCursor>;

export interface AttachDocumentInput {
  displayTitle?: string | null | undefined;
  tags?: readonly string[] | undefined;
}

export interface UpdateWorkspaceDocumentInput {
  displayTitle?: string | null | undefined;
  tags?: readonly string[] | undefined;
}

export interface DocumentRepository {
  attach: (
    userId: string,
    workspaceId: string,
    documentId: string,
    input?: AttachDocumentInput,
  ) => Promise<WorkspaceDocument | null>;
  create: (userId: string, input: CreateDocumentInput) => Promise<Document>;
  detach: (userId: string, workspaceId: string, documentId: string) => Promise<boolean>;
  findById: (userId: string, id: string) => Promise<Document | null>;
  findBySha256: (userId: string, sha256: string) => Promise<Document | null>;
  list: (input: ListDocumentsInput) => Promise<DocumentPage>;
  listWorkspaceDocuments: (input: ListWorkspaceDocumentsInput) => Promise<WorkspaceDocumentPage>;
  markDeletingIfUnattached: (userId: string, id: string) => Promise<Document | null>;
  updateAttachment: (
    userId: string,
    workspaceId: string,
    documentId: string,
    input: UpdateWorkspaceDocumentInput,
  ) => Promise<WorkspaceDocument | null>;
  updateMetadata: (
    userId: string,
    id: string,
    input: UpdateDocumentMetadataInput,
  ) => Promise<Document | null>;
}

export function createDocumentRepository(db: DatabaseExecutor): DocumentRepository {
  return {
    async attach(userId, workspaceId, documentId, input = {}) {
      const [ownedPair] = await db
        .select({ documentId: documents.id })
        .from(documents)
        .innerJoin(
          workspaces,
          and(eq(workspaces.userId, documents.userId), eq(workspaces.userId, userId)),
        )
        .where(
          and(
            eq(documents.userId, userId),
            eq(documents.id, documentId),
            eq(workspaces.id, workspaceId),
          ),
        )
        .limit(1);

      if (!ownedPair) return null;

      const [attached] = await db
        .insert(workspaceDocuments)
        .values({
          documentId,
          displayTitle: input.displayTitle,
          tags: normalizeTags(input.tags),
          userId,
          workspaceId,
        })
        .onConflictDoNothing({
          target: [workspaceDocuments.workspaceId, workspaceDocuments.documentId],
        })
        .returning();

      if (attached) return attached;

      const [existing] = await db
        .select()
        .from(workspaceDocuments)
        .where(
          and(
            eq(workspaceDocuments.userId, userId),
            eq(workspaceDocuments.workspaceId, workspaceId),
            eq(workspaceDocuments.documentId, documentId),
          ),
        )
        .limit(1);

      return existing ?? null;
    },

    async create(userId, input) {
      const [created] = await db
        .insert(documents)
        .values({
          ...input,
          userId,
        })
        .returning();

      if (!created) {
        throw new Error("Document insert did not return a row");
      }

      return created;
    },

    async detach(userId, workspaceId, documentId) {
      const detached = await db
        .delete(workspaceDocuments)
        .where(
          and(
            eq(workspaceDocuments.userId, userId),
            eq(workspaceDocuments.workspaceId, workspaceId),
            eq(workspaceDocuments.documentId, documentId),
          ),
        )
        .returning({ documentId: workspaceDocuments.documentId });

      return detached.length > 0;
    },

    async findById(userId, id) {
      const [document] = await db
        .select()
        .from(documents)
        .where(and(eq(documents.userId, userId), eq(documents.id, id)))
        .limit(1);

      return document ?? null;
    },

    async findBySha256(userId, sha256) {
      const [document] = await db
        .select()
        .from(documents)
        .where(and(eq(documents.userId, userId), eq(documents.sha256, sha256)))
        .limit(1);

      return document ?? null;
    },

    async list(input) {
      const cursorCondition = input.cursor
        ? or(
            lt(documents.createdAt, input.cursor.createdAt),
            and(eq(documents.createdAt, input.cursor.createdAt), lt(documents.id, input.cursor.id)),
          )
        : undefined;
      const normalizedTags = normalizeTags(input.tags);
      const attachmentFilter =
        input.workspaceId !== undefined || normalizedTags.length > 0
          ? exists(
              db
                .select({ value: sql`1` })
                .from(workspaceDocuments)
                .where(
                  and(
                    eq(workspaceDocuments.userId, documents.userId),
                    eq(workspaceDocuments.documentId, documents.id),
                    input.workspaceId === undefined
                      ? undefined
                      : eq(workspaceDocuments.workspaceId, input.workspaceId),
                    normalizedTags.length === 0
                      ? undefined
                      : arrayContains(workspaceDocuments.tags, normalizedTags),
                  ),
                ),
            )
          : undefined;
      const rows = await db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.userId, input.userId),
            input.status === undefined ? undefined : eq(documents.status, input.status),
            cursorCondition,
            attachmentFilter,
          ),
        )
        .orderBy(desc(documents.createdAt), desc(documents.id))
        .limit(input.limit + 1);
      return createCursorPage(rows, input.limit, ({ createdAt, id }) => ({ createdAt, id }));
    },

    async listWorkspaceDocuments(input) {
      const cursorCondition = input.cursor
        ? or(
            lt(workspaceDocuments.attachedAt, input.cursor.attachedAt),
            and(
              eq(workspaceDocuments.attachedAt, input.cursor.attachedAt),
              lt(workspaceDocuments.documentId, input.cursor.id),
            ),
          )
        : undefined;
      const normalizedTags = normalizeTags(input.tags);
      const rows = await db
        .select({ attachment: workspaceDocuments, document: documents })
        .from(workspaceDocuments)
        .innerJoin(
          documents,
          and(
            eq(documents.userId, workspaceDocuments.userId),
            eq(documents.id, workspaceDocuments.documentId),
          ),
        )
        .where(
          and(
            eq(workspaceDocuments.userId, input.userId),
            eq(workspaceDocuments.workspaceId, input.workspaceId),
            input.status === undefined ? undefined : eq(documents.status, input.status),
            normalizedTags.length === 0
              ? undefined
              : arrayContains(workspaceDocuments.tags, normalizedTags),
            cursorCondition,
          ),
        )
        .orderBy(desc(workspaceDocuments.attachedAt), desc(workspaceDocuments.documentId))
        .limit(input.limit + 1);

      return createCursorPage(rows, input.limit, ({ attachment }) => ({
        attachedAt: attachment.attachedAt,
        id: attachment.documentId,
      }));
    },

    async markDeletingIfUnattached(userId, id) {
      const [updated] = await db
        .update(documents)
        .set({ status: "deleting", updatedAt: new Date() })
        .where(
          and(
            eq(documents.userId, userId),
            eq(documents.id, id),
            notExists(
              db
                .select({ value: sql`1` })
                .from(workspaceDocuments)
                .where(
                  and(
                    eq(workspaceDocuments.userId, documents.userId),
                    eq(workspaceDocuments.documentId, documents.id),
                  ),
                ),
            ),
          ),
        )
        .returning();

      return updated ?? null;
    },

    async updateAttachment(userId, workspaceId, documentId, input) {
      const [updated] = await db
        .update(workspaceDocuments)
        .set({
          ...(input.displayTitle === undefined ? {} : { displayTitle: input.displayTitle }),
          ...(input.tags === undefined ? {} : { tags: normalizeTags(input.tags) }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workspaceDocuments.userId, userId),
            eq(workspaceDocuments.workspaceId, workspaceId),
            eq(workspaceDocuments.documentId, documentId),
          ),
        )
        .returning();

      return updated ?? null;
    },

    async updateMetadata(userId, id, input) {
      const [updated] = await db
        .update(documents)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(documents.userId, userId), eq(documents.id, id)))
        .returning();

      return updated ?? null;
    },
  };
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (tags === undefined) return [];

  const normalized = [...new Set(tags.map((tag) => tag.normalize("NFKC").trim().toLowerCase()))];

  if (normalized.length > 32) {
    throw new RangeError("Workspace document tags cannot contain more than 32 unique values");
  }
  if (normalized.some((tag) => tag.length === 0 || Array.from(tag).length > 64)) {
    throw new RangeError("Workspace document tags must contain between 1 and 64 characters");
  }

  return normalized;
}
