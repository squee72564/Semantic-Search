import { describe, expect, it } from "vitest";

import {
  createWorkspaceSchema,
  encodeWorkspaceCursor,
  updateWorkspaceSchema,
  workspaceParamsSchema,
  workspacesQuerySchema,
} from "./workspace.js";

const workspaceId = "0198b3f4-6fb4-7000-8000-000000000001";

describe("workspace validation", () => {
  it("normalizes create and update input", () => {
    expect(
      createWorkspaceSchema.parse({
        description: "  Reference material  ",
        name: "  Research  ",
      }),
    ).toEqual({
      description: "Reference material",
      name: "Research",
    });
    expect(updateWorkspaceSchema.parse({ description: null, name: "  Renamed  " })).toEqual({
      description: null,
      name: "Renamed",
    });
  });

  it("rejects blank names, unknown fields, and empty updates", () => {
    expect(createWorkspaceSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createWorkspaceSchema.safeParse({ name: "Research", userId: "user-2" }).success).toBe(
      false,
    );
    expect(updateWorkspaceSchema.safeParse({}).success).toBe(false);
  });

  it("validates UUID path parameters", () => {
    expect(workspaceParamsSchema.safeParse({ id: workspaceId }).success).toBe(true);
    expect(workspaceParamsSchema.safeParse({ id: "1" }).success).toBe(false);
  });

  it("round-trips opaque list cursors and applies the default limit", () => {
    const createdAt = new Date("2026-08-01T12:00:00.000Z");
    const cursor = encodeWorkspaceCursor({ createdAt, id: workspaceId });
    const result = workspacesQuerySchema.parse({ cursor });

    expect(result).toEqual({ cursor: { createdAt, id: workspaceId }, limit: 20 });
  });

  it("rejects malformed cursors and out-of-range limits", () => {
    expect(workspacesQuerySchema.safeParse({ cursor: "not-a-cursor" }).success).toBe(false);
    expect(workspacesQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(workspacesQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });
});
