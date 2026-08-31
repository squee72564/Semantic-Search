import { drizzle } from "drizzle-orm/postgres-js";
import { describe, expect, it } from "vitest";

import * as schema from "../schema/index.js";
import { createWorkspaceRepository } from "./workspaces.js";

interface CapturedQuery {
  parameters: readonly unknown[];
  sql: string;
}

const createdAt = new Date("2026-08-30T12:00:00.000Z");
const updatedAt = new Date("2026-08-30T13:00:00.000Z");
const userId = "user-1";
const workspaceId = "00000000-0000-4000-8000-000000000001";

function workspaceRow({
  description = "Reference material",
  id = workspaceId,
  name = "Research",
  ownerId = userId,
}: {
  description?: string | null;
  id?: string;
  name?: string;
  ownerId?: string;
} = {}): unknown[] {
  return [id, ownerId, name, description, createdAt, updatedAt];
}

function createRecordingDatabase(responses: unknown[][][]) {
  const queries: CapturedQuery[] = [];
  const client = {
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

describe("Workspace repository", () => {
  it("creates a workspace for the authenticated user", async () => {
    const { db, queries } = createRecordingDatabase([[workspaceRow()]]);
    const repository = createWorkspaceRepository(db);

    const created = await repository.create(userId, {
      description: "Reference material",
      name: "Research",
    });

    expect(created).toMatchObject({ id: workspaceId, name: "Research", userId });
    expect(queries[0]?.sql).toContain('insert into "workspaces"');
    expect(queries[0]?.parameters).toEqual([userId, "Research", "Reference material"]);
  });

  it("scopes reads, updates, and deletes by both workspace and user", async () => {
    const { db, queries } = createRecordingDatabase([
      [workspaceRow()],
      [workspaceRow({ name: "Renamed" })],
      [[workspaceId]],
    ]);
    const repository = createWorkspaceRepository(db);

    await expect(repository.findById(userId, workspaceId)).resolves.toMatchObject({
      id: workspaceId,
      userId,
    });
    await expect(
      repository.update(userId, workspaceId, { name: "Renamed" }),
    ).resolves.toMatchObject({ name: "Renamed", userId });
    await expect(repository.delete(userId, workspaceId)).resolves.toBe(true);

    for (const query of queries) {
      expect(query.sql).toContain('"workspaces"."id"');
      expect(query.sql).toContain('"workspaces"."user_id"');
      expect(query.parameters).toContain(workspaceId);
      expect(query.parameters).toContain(userId);
    }
  });

  it("returns not-found results without exposing a workspace owned by another user", async () => {
    const { db } = createRecordingDatabase([[], [], []]);
    const repository = createWorkspaceRepository(db);

    await expect(repository.findById("other-user", workspaceId)).resolves.toBeNull();
    await expect(
      repository.update("other-user", workspaceId, { name: "Unauthorized rename" }),
    ).resolves.toBeNull();
    await expect(repository.delete("other-user", workspaceId)).resolves.toBe(false);
  });

  it("lists only the user's workspaces with deterministic cursor pagination", async () => {
    const secondId = "00000000-0000-4000-8000-000000000002";
    const thirdId = "00000000-0000-4000-8000-000000000003";
    const { db, queries } = createRecordingDatabase([
      [workspaceRow(), workspaceRow({ id: secondId }), workspaceRow({ id: thirdId })],
    ]);
    const repository = createWorkspaceRepository(db);

    const page = await repository.list({
      cursor: { createdAt, id: workspaceId },
      limit: 2,
      userId,
    });

    expect(page).toMatchObject({ nextCursor: { createdAt, id: secondId } });
    expect(page.items).toHaveLength(2);
    expect(queries[0]?.sql).toContain('where ("workspaces"."user_id"');
    expect(queries[0]?.sql).toContain(
      'order by "workspaces"."created_at" desc, "workspaces"."id" desc',
    );
    expect(queries[0]?.parameters).toContain(userId);
    expect(queries[0]?.parameters).toContain(workspaceId);
    expect(queries[0]?.parameters).toContain(3);
  });
});
