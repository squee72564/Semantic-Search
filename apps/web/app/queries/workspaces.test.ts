import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { browserApiClient } from "~/lib/api.client";
import {
  createWorkspaceMutation,
  deleteWorkspaceMutation,
  updateWorkspaceMutation,
  workspaceQuery,
  workspaceQueryKeys,
  workspacesQuery,
} from "~/queries/workspaces";
import { mockApi } from "~/test-setup";

describe("workspace queries", () => {
  it("builds stable list and detail keys", () => {
    expect(workspaceQueryKeys.list({ limit: "4" })).toEqual(["workspaces", "list", { limit: "4" }]);
    expect(workspaceQueryKeys.detail("workspace-1")).toEqual([
      "workspaces",
      "detail",
      "workspace-1",
    ]);
  });

  it("calls list and detail endpoints", async () => {
    const list = await workspacesQuery(browserApiClient, { limit: "1" }).queryFn!({} as never);
    const detail = await workspaceQuery(browserApiClient, list.items[0]!.id).queryFn!({} as never);
    expect(list.limit).toBe(1);
    expect(detail.item.id).toBe(list.items[0]!.id);
  });

  it("sends create, update, and delete requests", async () => {
    const created = await createWorkspaceMutation(browserApiClient).mutationFn!(
      { name: "New", description: null },
      {} as never,
    );
    const updated = await updateWorkspaceMutation(browserApiClient).mutationFn!(
      { id: created.item.id, workspace: { name: "Renamed" } },
      {} as never,
    );
    await expect(
      deleteWorkspaceMutation(browserApiClient).mutationFn!(created.item.id, {} as never),
    ).resolves.toBeUndefined();
    expect(updated.item.name).toBe("Renamed");
  });

  it("rejects unsuccessful responses", async () => {
    mockApi.use(http.get("*/workspaces", () => HttpResponse.json({}, { status: 503 })));
    await expect(workspacesQuery(browserApiClient).queryFn!({} as never)).rejects.toThrow(
      "Workspace API returned 503",
    );
  });
});
