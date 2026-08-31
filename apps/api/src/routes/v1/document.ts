import { zValidator } from "@hono/zod-validator";
import type {
  Document,
  DocumentRepository,
  WorkspaceDocument,
  WorkspaceRepository,
} from "@repo/db";
import { Hono, type MiddlewareHandler } from "hono";

import { getAuthenticatedUser } from "../../lib/auth.js";
import type { AppVariables } from "../../lib/context.js";
import { ApiError } from "../../lib/error.js";
import {
  attachDocumentSchema,
  documentParamsSchema,
  documentsQuerySchema,
  documentValidationHook,
  encodeDocumentCursor,
  encodeWorkspaceDocumentCursor,
  updateDocumentMetadataSchema,
  updateWorkspaceDocumentSchema,
  workspaceDocumentParamsSchema,
  workspaceDocumentsParamsSchema,
  workspaceDocumentsQuerySchema,
} from "../../validation/document.js";

type AppEnv = { Variables: AppVariables };

function documentNotFound(id: string) {
  return new ApiError({
    code: "DOCUMENT_NOT_FOUND",
    expose: true,
    message: `Document ${id} was not found for the authenticated user`,
    status: 404,
    userMessage: "The requested document was not found.",
  });
}

function workspaceNotFound(id: string) {
  return new ApiError({
    code: "WORKSPACE_NOT_FOUND",
    expose: true,
    message: `Workspace ${id} was not found for the authenticated user`,
    status: 404,
    userMessage: "The requested workspace was not found.",
  });
}

function workspaceDocumentNotFound(workspaceId: string, documentId: string) {
  return new ApiError({
    code: "WORKSPACE_DOCUMENT_NOT_FOUND",
    expose: true,
    message: `Document ${documentId} or workspace ${workspaceId} was not found for the authenticated user`,
    status: 404,
    userMessage: "The requested workspace document was not found.",
  });
}

function documentAttached(id: string) {
  return new ApiError({
    code: "DOCUMENT_ATTACHED",
    expose: true,
    message: `Document ${id} cannot be deleted while it is attached to a workspace`,
    status: 409,
    userMessage: "Detach this document from every workspace before deleting it.",
  });
}

function toDocumentResponse(document: Document) {
  return {
    createdAt: document.createdAt,
    customMetadata: document.customMetadata,
    description: document.description,
    id: document.id,
    originalContentType: document.originalContentType,
    originalFilename: document.originalFilename,
    originalSizeBytes: document.originalSizeBytes,
    pageCount: document.pageCount,
    sha256: document.sha256,
    status: document.status,
    title: document.title,
    updatedAt: document.updatedAt,
  };
}

function toWorkspaceDocumentResponse(attachment: WorkspaceDocument) {
  return {
    attachedAt: attachment.attachedAt,
    displayTitle: attachment.displayTitle,
    documentId: attachment.documentId,
    tags: attachment.tags,
    updatedAt: attachment.updatedAt,
    workspaceId: attachment.workspaceId,
  };
}

export function createDocumentRoutes(
  documentRepository: DocumentRepository,
  requireAuth: MiddlewareHandler<AppEnv>,
) {
  return new Hono<AppEnv>()
    .use("*", requireAuth)
    .get(
      "/",
      zValidator("query", documentsQuerySchema, documentValidationHook),
      async (context) => {
        const user = getAuthenticatedUser(context);
        const { cursor, limit, status, tag: tags, workspaceId } = context.req.valid("query");
        const page = await documentRepository.list({
          cursor,
          limit,
          status,
          tags,
          userId: user.id,
          workspaceId,
        });
        const nextCursor = page.nextCursor === null ? null : encodeDocumentCursor(page.nextCursor);

        return context.json(
          {
            items: page.items.map(toDocumentResponse),
            limit,
            pageInfo: { nextCursor },
          },
          200,
        );
      },
    )
    .get(
      "/:id",
      zValidator("param", documentParamsSchema, documentValidationHook),
      async (context) => {
        const user = getAuthenticatedUser(context);
        const { id } = context.req.valid("param");
        const item = await documentRepository.findById(user.id, id);

        if (!item) throw documentNotFound(id);

        return context.json({ item: toDocumentResponse(item) }, 200);
      },
    )
    .patch(
      "/:id",
      zValidator("param", documentParamsSchema, documentValidationHook),
      zValidator("json", updateDocumentMetadataSchema, documentValidationHook),
      async (context) => {
        const user = getAuthenticatedUser(context);
        const { id } = context.req.valid("param");
        const item = await documentRepository.updateMetadata(
          user.id,
          id,
          context.req.valid("json"),
        );

        if (!item) throw documentNotFound(id);

        return context.json({ item: toDocumentResponse(item) }, 200);
      },
    )
    .delete(
      "/:id",
      zValidator("param", documentParamsSchema, documentValidationHook),
      async (context) => {
        const user = getAuthenticatedUser(context);
        const { id } = context.req.valid("param");
        const item = await documentRepository.markDeletingIfUnattached(user.id, id);

        if (item) return context.json({ item: toDocumentResponse(item) }, 202);

        const existing = await documentRepository.findById(user.id, id);

        if (!existing) throw documentNotFound(id);
        throw documentAttached(id);
      },
    );
}

export function createWorkspaceDocumentRoutes(
  documentRepository: DocumentRepository,
  workspaceRepository: WorkspaceRepository,
  requireAuth: MiddlewareHandler<AppEnv>,
) {
  return new Hono<AppEnv>()
    .use("*", requireAuth)
    .get(
      "/",
      zValidator("param", workspaceDocumentsParamsSchema, documentValidationHook),
      zValidator("query", workspaceDocumentsQuerySchema, documentValidationHook),
      async (context) => {
        const user = getAuthenticatedUser(context);
        const { workspaceId } = context.req.valid("param");
        const { cursor, limit, status, tag: tags } = context.req.valid("query");
        const workspace = await workspaceRepository.findById(user.id, workspaceId);

        if (!workspace) throw workspaceNotFound(workspaceId);

        const page = await documentRepository.listWorkspaceDocuments({
          cursor,
          limit,
          status,
          tags,
          userId: user.id,
          workspaceId,
        });
        const nextCursor =
          page.nextCursor === null ? null : encodeWorkspaceDocumentCursor(page.nextCursor);

        return context.json(
          {
            items: page.items.map(({ attachment, document }) => ({
              attachment: toWorkspaceDocumentResponse(attachment),
              document: toDocumentResponse(document),
            })),
            limit,
            pageInfo: { nextCursor },
          },
          200,
        );
      },
    )
    .put(
      "/:documentId",
      zValidator("param", workspaceDocumentParamsSchema, documentValidationHook),
      zValidator("json", attachDocumentSchema, documentValidationHook),
      async (context) => {
        const user = getAuthenticatedUser(context);
        const { documentId, workspaceId } = context.req.valid("param");
        const item = await documentRepository.attach(
          user.id,
          workspaceId,
          documentId,
          context.req.valid("json"),
        );

        if (!item) throw workspaceDocumentNotFound(workspaceId, documentId);

        return context.json({ item: toWorkspaceDocumentResponse(item) }, 200);
      },
    )
    .patch(
      "/:documentId",
      zValidator("param", workspaceDocumentParamsSchema, documentValidationHook),
      zValidator("json", updateWorkspaceDocumentSchema, documentValidationHook),
      async (context) => {
        const user = getAuthenticatedUser(context);
        const { documentId, workspaceId } = context.req.valid("param");
        const item = await documentRepository.updateAttachment(
          user.id,
          workspaceId,
          documentId,
          context.req.valid("json"),
        );

        if (!item) throw workspaceDocumentNotFound(workspaceId, documentId);

        return context.json({ item: toWorkspaceDocumentResponse(item) }, 200);
      },
    )
    .delete(
      "/:documentId",
      zValidator("param", workspaceDocumentParamsSchema, documentValidationHook),
      async (context) => {
        const user = getAuthenticatedUser(context);
        const { documentId, workspaceId } = context.req.valid("param");
        const detached = await documentRepository.detach(user.id, workspaceId, documentId);

        if (!detached) throw workspaceDocumentNotFound(workspaceId, documentId);

        return context.body(null, 204);
      },
    );
}
