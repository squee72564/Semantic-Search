import { documentStatus, type DocumentCursor, type WorkspaceDocumentCursor } from "@repo/db";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";

import { ApiError } from "../lib/error.js";

const documentCursorPayloadSchema = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

const workspaceDocumentCursorPayloadSchema = z.object({
  attachedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

function decodeCursor<T>(
  value: string,
  context: z.RefinementCtx,
  decode: (value: unknown) => T | null,
): T {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const cursor = decode(decoded);

    if (cursor !== null) return cursor;
  } catch {
    // The issue below intentionally presents all malformed cursors identically.
  }

  context.addIssue({ code: "custom", message: "Invalid pagination cursor" });
  return z.NEVER;
}

const documentCursorSchema = z
  .string()
  .min(1)
  .transform(
    (value, context): DocumentCursor =>
      decodeCursor(value, context, (decoded) => {
        const parsed = documentCursorPayloadSchema.safeParse(decoded);

        return parsed.success
          ? { createdAt: new Date(parsed.data.createdAt), id: parsed.data.id }
          : null;
      }),
  );

const workspaceDocumentCursorSchema = z
  .string()
  .min(1)
  .transform(
    (value, context): WorkspaceDocumentCursor =>
      decodeCursor(value, context, (decoded) => {
        const parsed = workspaceDocumentCursorPayloadSchema.safeParse(decoded);

        return parsed.success
          ? { attachedAt: new Date(parsed.data.attachedAt), id: parsed.data.id }
          : null;
      }),
  );

const normalizedTagSchema = z
  .string()
  .transform((value) => value.normalize("NFKC").trim().toLowerCase())
  .pipe(z.string().min(1).max(64));

const tagsSchema = z
  .array(normalizedTagSchema)
  .transform((tags) => [...new Set(tags)])
  .refine((tags) => tags.length <= 32, { message: "No more than 32 tags are allowed" });

const queryTagsSchema = z
  .union([normalizedTagSchema.transform((tag) => [tag]), tagsSchema])
  .transform((tags) => [...new Set(tags)])
  .refine((tags) => tags.length <= 32, { message: "No more than 32 tags are allowed" });

const nullableTitleSchema = z.string().trim().min(1).max(255).nullable();
const nullableDescriptionSchema = z.string().trim().max(10_000).nullable();

export const documentParamsSchema = z.object({ id: z.uuid() }).strict();

export const workspaceDocumentParamsSchema = z
  .object({ documentId: z.uuid(), workspaceId: z.uuid() })
  .strict();

export const workspaceDocumentsParamsSchema = z.object({ workspaceId: z.uuid() }).strict();

export const documentsQuerySchema = z
  .object({
    cursor: documentCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(documentStatus.enumValues).optional(),
    tag: queryTagsSchema.optional(),
    workspaceId: z.uuid().optional(),
  })
  .strict();

export const workspaceDocumentsQuerySchema = z
  .object({
    cursor: workspaceDocumentCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(documentStatus.enumValues).optional(),
    tag: queryTagsSchema.optional(),
  })
  .strict();

export const updateDocumentMetadataSchema = z
  .object({
    customMetadata: z.record(z.string(), z.unknown()).optional(),
    description: nullableDescriptionSchema.optional(),
    title: nullableTitleSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one field must be provided",
  });

export const attachDocumentSchema = z
  .object({
    displayTitle: nullableTitleSchema.optional(),
    tags: tagsSchema.optional(),
  })
  .strict();

export const updateWorkspaceDocumentSchema = attachDocumentSchema.refine(
  (input) => Object.keys(input).length > 0,
  { message: "At least one field must be provided" },
);

export function encodeDocumentCursor(cursor: DocumentCursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
  ).toString("base64url");
}

export function encodeWorkspaceDocumentCursor(cursor: WorkspaceDocumentCursor): string {
  return Buffer.from(
    JSON.stringify({ attachedAt: cursor.attachedAt.toISOString(), id: cursor.id }),
  ).toString("base64url");
}

export function documentValidationHook(result: {
  success: boolean;
  error?: { issues: unknown[] } | undefined;
}) {
  if (!result.success) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      details: { issues: result.error?.issues ?? [] },
      expose: true,
      message: "Document request validation failed",
      status: StatusCodes.BAD_REQUEST,
      userMessage: "The document request is invalid.",
    });
  }
}
