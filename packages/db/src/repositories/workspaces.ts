import { and, desc, eq, lt, or } from "drizzle-orm";

import type { Database } from "../client.js";
import { workspaces, type Workspace } from "../schema/workspaces.js";
import { createCursorPage, type CursorPage } from "./pagination.js";

export interface WorkspaceCursor {
  createdAt: Date;
  id: string;
}

export interface ListWorkspacesInput {
  cursor?: WorkspaceCursor | undefined;
  limit: number;
  userId: string;
}

export interface CreateWorkspaceInput {
  description?: string | null | undefined;
  name: string;
}

export interface UpdateWorkspaceInput {
  description?: string | null | undefined;
  name?: string | undefined;
}

export type WorkspacePage = CursorPage<Workspace, WorkspaceCursor>;

export interface WorkspaceRepository {
  create: (userId: string, input: CreateWorkspaceInput) => Promise<Workspace>;
  delete: (userId: string, id: string) => Promise<boolean>;
  findById: (userId: string, id: string) => Promise<Workspace | null>;
  list: (input: ListWorkspacesInput) => Promise<WorkspacePage>;
  update: (userId: string, id: string, input: UpdateWorkspaceInput) => Promise<Workspace | null>;
}

export function createWorkspaceRepository(db: Database): WorkspaceRepository {
  return {
    async create(userId, input) {
      const [created] = await db
        .insert(workspaces)
        .values({
          ...input,
          userId,
        })
        .returning();

      if (!created) {
        throw new Error("Workspace insert did not return a row");
      }

      return created;
    },

    async delete(userId, id) {
      const deleted = await db
        .delete(workspaces)
        .where(and(eq(workspaces.id, id), eq(workspaces.userId, userId)))
        .returning({ id: workspaces.id });

      return deleted.length > 0;
    },

    async findById(userId, id) {
      const [workspace] = await db
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.id, id), eq(workspaces.userId, userId)))
        .limit(1);

      return workspace ?? null;
    },

    async list(input) {
      const cursorCondition = input.cursor
        ? or(
            lt(workspaces.createdAt, input.cursor.createdAt),
            and(
              eq(workspaces.createdAt, input.cursor.createdAt),
              lt(workspaces.id, input.cursor.id),
            ),
          )
        : undefined;
      const rows = await db
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.userId, input.userId), cursorCondition))
        .orderBy(desc(workspaces.createdAt), desc(workspaces.id))
        .limit(input.limit + 1);
      return createCursorPage(rows, input.limit, ({ createdAt, id }) => ({ createdAt, id }));
    },

    async update(userId, id, input) {
      const [updated] = await db
        .update(workspaces)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(and(eq(workspaces.id, id), eq(workspaces.userId, userId)))
        .returning();

      return updated ?? null;
    },
  };
}
