import { zValidator } from "@hono/zod-validator";
import type { WorkspaceRepository } from "@repo/db";
import { Hono, type MiddlewareHandler } from "hono";

import { getAuthenticatedUser } from "../../lib/auth.js";
import type { AppVariables } from "../../lib/context.js";
import { ApiError } from "../../lib/error.js";
import {
  createWorkspaceSchema,
  encodeWorkspaceCursor,
  updateWorkspaceSchema,
  workspaceParamsSchema,
  workspacesQuerySchema,
  workspaceValidationHook,
} from "../../validation/workspace.js";

type AppEnv = { Variables: AppVariables };

function workspaceNotFound(id: string) {
  return new ApiError({
    code: "WORKSPACE_NOT_FOUND",
    expose: true,
    message: `Workspace ${id} was not found for the authenticated user`,
    status: 404,
    userMessage: "The requested workspace was not found.",
  });
}

export function createWorkspaceRoutes(
  workspaceRepository: WorkspaceRepository,
  requireAuth: MiddlewareHandler<AppEnv>,
) {
  return new Hono<AppEnv>()
    .use("*", requireAuth)
    .get(
      "/",
      zValidator("query", workspacesQuerySchema, workspaceValidationHook),
      async (context) => {
        const user = getAuthenticatedUser(context);
        const query = context.req.valid("query");
        const page = await workspaceRepository.list({
          ...query,
          userId: user.id,
        });
        const lastItem = page.items.at(-1);
        const nextCursor =
          page.hasMore && lastItem
            ? encodeWorkspaceCursor({ createdAt: lastItem.createdAt, id: lastItem.id })
            : null;

        return context.json(
          {
            items: page.items,
            limit: query.limit,
            pageInfo: { hasMore: page.hasMore, nextCursor },
          },
          200,
        );
      },
    )
    .post(
      "/",
      zValidator("json", createWorkspaceSchema, workspaceValidationHook),
      async (context) => {
        const user = getAuthenticatedUser(context);
        const item = await workspaceRepository.create(user.id, context.req.valid("json"));

        context.header("Location", `/workspaces/${item.id}`);
        return context.json({ item }, 201);
      },
    )
    .get(
      "/:id",
      zValidator("param", workspaceParamsSchema, workspaceValidationHook),
      async (context) => {
        const user = getAuthenticatedUser(context);
        const { id } = context.req.valid("param");
        const item = await workspaceRepository.findById(user.id, id);

        if (!item) {
          throw workspaceNotFound(id);
        }

        return context.json({ item }, 200);
      },
    )
    .patch(
      "/:id",
      zValidator("param", workspaceParamsSchema, workspaceValidationHook),
      zValidator("json", updateWorkspaceSchema, workspaceValidationHook),
      async (context) => {
        const user = getAuthenticatedUser(context);
        const { id } = context.req.valid("param");
        const item = await workspaceRepository.update(user.id, id, context.req.valid("json"));

        if (!item) {
          throw workspaceNotFound(id);
        }

        return context.json({ item }, 200);
      },
    )
    .delete(
      "/:id",
      zValidator("param", workspaceParamsSchema, workspaceValidationHook),
      async (context) => {
        const user = getAuthenticatedUser(context);
        const { id } = context.req.valid("param");
        const deleted = await workspaceRepository.delete(user.id, id);

        if (!deleted) {
          throw workspaceNotFound(id);
        }

        return context.body(null, 204);
      },
    );
}
