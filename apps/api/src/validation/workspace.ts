import type { WorkspaceCursor } from "@repo/db";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";

import { ApiError } from "../lib/error.js";

const workspaceCursorPayloadSchema = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

const workspaceCursorSchema = z
  .string()
  .min(1)
  .transform((value, context): WorkspaceCursor => {
    try {
      const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
      const parsed = workspaceCursorPayloadSchema.safeParse(decoded);

      if (parsed.success) {
        return {
          createdAt: new Date(parsed.data.createdAt),
          id: parsed.data.id,
        };
      }
    } catch {
      // The issue below intentionally presents all malformed cursors identically.
    }

    context.addIssue({ code: "custom", message: "Invalid pagination cursor" });
    return z.NEVER;
  });

export const workspaceParamsSchema = z.object({ id: z.uuid() }).strict();

export const workspacesQuerySchema = z
  .object({
    cursor: workspaceCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const createWorkspaceSchema = z
  .object({
    description: z.string().trim().max(10_000).nullable().optional(),
    name: z.string().trim().min(1).max(255),
  })
  .strict();

export const updateWorkspaceSchema = createWorkspaceSchema
  .partial()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one field must be provided",
  });

export function encodeWorkspaceCursor(cursor: WorkspaceCursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
  ).toString("base64url");
}

export function workspaceValidationHook(result: {
  success: boolean;
  error?: { issues: unknown[] } | undefined;
}) {
  if (!result.success) {
    throw new ApiError({
      code: "VALIDATION_ERROR",
      details: { issues: result.error?.issues ?? [] },
      expose: true,
      message: "Workspace request validation failed",
      status: StatusCodes.BAD_REQUEST,
      userMessage: "The workspace request is invalid.",
    });
  }
}
