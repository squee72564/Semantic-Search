import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { browserApiClient } from "~/lib/api.client";
import {
  createWorkspaceMutation,
  deleteWorkspaceMutation,
  sidebarWorkspacesQuery,
  updateWorkspaceMutation,
  workspaceQuery,
  workspaceQueryKeys,
  workspacesQuery,
} from "~/queries/workspaces";
import { mockApi } from "~/test-setup";

describe("workspace queries", () => {
  it("builds stable list and detail keys", () => {
    expect(workspaceQueryKeys.list({ limit: "4" })).toEqual(["workspaces", "list", { limit: "4" }]);
    expect(workspaceQueryKeys.sidebar()).toEqual(["workspaces", "list", "sidebar"]);
    expect(workspaceQueryKeys.detail("workspace-1")).toEqual([
      "workspaces",
      "detail",
      "workspace-1",
    ]);
  });

  it("loads and flattens every sidebar page", async () => {
    const requests: Array<{ cursor: string | null; limit: string | null }> = [];
    mockApi.use(
      http.get("*/workspaces", ({ request }) => {
        const url = new URL(request.url);
        const cursor = url.searchParams.get("cursor");
        requests.push({ cursor, limit: url.searchParams.get("limit") });

        if (!cursor) {
          return HttpResponse.json({
            items: [{ id: "workspace-1", name: "Newest" }],
            limit: 100,
            pageInfo: { nextCursor: "next-page" },
          });
        }

        return HttpResponse.json({
          items: [{ id: "workspace-2", name: "Oldest" }],
          limit: 100,
          pageInfo: { nextCursor: null },
        });
      }),
    );

    const result = await sidebarWorkspacesQuery(browserApiClient).queryFn!({} as never);

    expect(result.items.map((workspace) => workspace.id)).toEqual(["workspace-1", "workspace-2"]);
    expect(requests).toEqual([
      { cursor: null, limit: "100" },
      { cursor: "next-page", limit: "100" },
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
