import type { ApiClient } from "@repo/api/client";
import { mutationOptions, queryOptions } from "@tanstack/react-query";

type WorkspacesRoute = ApiClient["workspaces"];
type WorkspaceRoute = WorkspacesRoute[":id"];

export type WorkspacesQueryInput = NonNullable<Parameters<WorkspacesRoute["$get"]>[0]>["query"];
export type CreateWorkspaceInput = NonNullable<Parameters<WorkspacesRoute["$post"]>[0]>["json"];
export type UpdateWorkspaceInput = NonNullable<Parameters<WorkspaceRoute["$patch"]>[0]>["json"];

export interface UpdateWorkspaceVariables {
  id: string;
  workspace: UpdateWorkspaceInput;
}

export class WorkspaceApiError extends Error {
  constructor(public readonly status: number) {
    super(`Workspace API returned ${status}`);
    this.name = "WorkspaceApiError";
  }
}

export const workspaceQueryKeys = {
  all: ["workspaces"] as const,
  detail: (id: string) => [...workspaceQueryKeys.details(), id] as const,
  details: () => [...workspaceQueryKeys.all, "detail"] as const,
  list: (query: WorkspacesQueryInput) => [...workspaceQueryKeys.lists(), query] as const,
  lists: () => [...workspaceQueryKeys.all, "list"] as const,
  sidebar: () => [...workspaceQueryKeys.lists(), "sidebar"] as const,
};

function assertSuccessfulResponse(response: Response) {
  if (!response.ok) {
    throw new WorkspaceApiError(response.status);
  }
}

export function workspacesQuery(api: ApiClient, query: WorkspacesQueryInput = {}) {
  return queryOptions({
    queryKey: workspaceQueryKeys.list(query),
    queryFn: async () => {
      const response = await api.workspaces.$get({ query });
      assertSuccessfulResponse(response);
      return response.json();
    },
  });
}

export function sidebarWorkspacesQuery(api: ApiClient) {
  return queryOptions({
    queryKey: workspaceQueryKeys.sidebar(),
    queryFn: async () => {
      const fetchPage = async (cursor?: string) => {
        const response = await api.workspaces.$get({
          query: { ...(cursor ? { cursor } : {}), limit: "100" },
        });
        assertSuccessfulResponse(response);
        return response.json();
      };

      const firstPage = await fetchPage();
      const items = [...firstPage.items];
      let cursor = firstPage.pageInfo.nextCursor;

      while (cursor) {
        // eslint-disable-next-line no-await-in-loop -- each cursor is supplied by the preceding page.
        const page = await fetchPage(cursor);
        items.push(...page.items);
        cursor = page.pageInfo.nextCursor;
      }

      return { items };
    },
  });
}

export function workspaceQuery(api: ApiClient, id: string) {
  return queryOptions({
    queryKey: workspaceQueryKeys.detail(id),
    queryFn: async () => {
      const response = await api.workspaces[":id"].$get({ param: { id } });
      assertSuccessfulResponse(response);
      return response.json();
    },
  });
}

export function createWorkspaceMutation(api: ApiClient) {
  return mutationOptions({
    mutationKey: [...workspaceQueryKeys.all, "create"] as const,
    mutationFn: async (workspace: CreateWorkspaceInput) => {
      const response = await api.workspaces.$post({ json: workspace });
      assertSuccessfulResponse(response);
      return response.json();
    },
  });
}

export function updateWorkspaceMutation(api: ApiClient) {
  return mutationOptions({
    mutationKey: [...workspaceQueryKeys.all, "update"] as const,
    mutationFn: async ({ id, workspace }: UpdateWorkspaceVariables) => {
      const response = await api.workspaces[":id"].$patch({
        json: workspace,
        param: { id },
      });
      assertSuccessfulResponse(response);
      return response.json();
    },
  });
}

export function deleteWorkspaceMutation(api: ApiClient) {
  return mutationOptions({
    mutationKey: [...workspaceQueryKeys.all, "delete"] as const,
    mutationFn: async (id: string) => {
      const response = await api.workspaces[":id"].$delete({ param: { id } });
      assertSuccessfulResponse(response);
    },
  });
}
