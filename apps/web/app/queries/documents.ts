import type { ApiClient } from "@repo/api/client";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

type DocumentsRoute = ApiClient["documents"];
type DocumentRoute = DocumentsRoute[":id"];
type WorkspaceDocumentsRoute = ApiClient["workspaces"][":workspaceId"]["documents"];
type AttachmentRoute = WorkspaceDocumentsRoute[":documentId"];

export type WorkspaceDocumentsQueryInput = NonNullable<
  Parameters<WorkspaceDocumentsRoute["$get"]>[0]
>["query"];
export type WorkspaceDocumentItem = Awaited<
  ReturnType<Awaited<ReturnType<WorkspaceDocumentsRoute["$get"]>>["json"]>
>["items"][number];

export type DocumentsQueryInput = NonNullable<Parameters<DocumentsRoute["$get"]>[0]>["query"];
export type DocumentMetadataInput = NonNullable<Parameters<DocumentRoute["$patch"]>[0]>["json"];
export type AttachmentInput = NonNullable<Parameters<AttachmentRoute["$put"]>[0]>["json"];
export type DocumentItem = Awaited<
  ReturnType<Awaited<ReturnType<DocumentRoute["$get"]>>["json"]>
>["item"];
export type DocumentStatus = DocumentItem["status"];
export type UploadResponse = Awaited<
  ReturnType<Awaited<ReturnType<DocumentsRoute["$post"]>>["json"]>
>;

export const documentQueryKeys = {
  all: ["documents"] as const,
  workspace: (workspaceId: string) => ["documents", "workspace", workspaceId] as const,
  workspaceList: (workspaceId: string, query: WorkspaceDocumentsQueryInput) =>
    ["documents", "workspace", workspaceId, "list", query] as const,
  membership: (workspaceId: string) =>
    ["documents", "workspace", workspaceId, "membership"] as const,
  list: (query: DocumentsQueryInput) => ["documents", "list", query] as const,
  detail: (id: string) => ["documents", "detail", id] as const,
  attachment: (workspaceId: string, documentId: string) =>
    ["documents", "attachment", workspaceId, documentId] as const,
};

export class DocumentApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "DocumentApiError";
  }
}

async function assertSuccessfulResponse(response: Response) {
  if (response.ok) return;
  const problem: unknown = await response.json().catch(() => null);
  const detail =
    problem && typeof problem === "object" && "detail" in problem ? problem.detail : undefined;
  const code =
    problem && typeof problem === "object" && "code" in problem ? problem.code : undefined;
  throw new DocumentApiError(
    response.status,
    typeof detail === "string"
      ? detail
      : `Document request failed (${response.status}). Please try again.`,
    typeof code === "string" ? code : undefined,
  );
}

export function documentsQuery(api: ApiClient, query: DocumentsQueryInput = {}) {
  return queryOptions({
    queryKey: documentQueryKeys.list(query),
    queryFn: async ({ signal }) => {
      const response = await api.documents.$get({ query }, { init: { signal } });
      await assertSuccessfulResponse(response);
      return response.json();
    },
  });
}

export function documentQuery(api: ApiClient, id: string) {
  return queryOptions({
    queryKey: documentQueryKeys.detail(id),
    queryFn: async ({ signal }) => {
      const response = await api.documents[":id"].$get({ param: { id } }, { init: { signal } });
      await assertSuccessfulResponse(response);
      return response.json();
    },
  });
}

// There is no attachment-detail endpoint. Follow workspace cursors until the
// document is found or all pages have been checked; page one alone cannot prove absence.
export function documentAttachmentQuery(api: ApiClient, workspaceId: string, documentId: string) {
  return queryOptions({
    queryKey: documentQueryKeys.attachment(workspaceId, documentId),
    enabled: Boolean(workspaceId),
    queryFn: async ({ signal }) => {
      let cursor: string | null = null;
      do {
        // eslint-disable-next-line no-await-in-loop -- the previous page supplies the next cursor.
        const response = await api.workspaces[":workspaceId"].documents.$get(
          { param: { workspaceId }, query: { limit: "100", ...(cursor ? { cursor } : {}) } },
          { init: { signal } },
        );
        // eslint-disable-next-line no-await-in-loop -- validate each page before reading its cursor.
        await assertSuccessfulResponse(response);
        // eslint-disable-next-line no-await-in-loop -- the next cursor is in this response.
        const page = await response.json();
        const match = page.items.find((item) => item.document.id === documentId);
        if (match) return match.attachment;
        cursor = page.pageInfo.nextCursor;
      } while (cursor);
      return null;
    },
  });
}

export function uploadDocumentMutation(api: ApiClient) {
  return mutationOptions({
    mutationKey: ["documents", "upload"],
    retry: false,
    mutationFn: async ({
      file,
      metadata,
      signal,
    }: {
      file: File;
      metadata: DocumentMetadataInput;
      signal: AbortSignal;
    }) => {
      const body = new FormData();
      body.append("file", file);
      body.append("metadata", JSON.stringify(metadata));
      // The route parses the stream itself, so Hono has no inferred form schema.
      // Let the browser generate Content-Type, including the multipart boundary.
      const response = await api.documents.$post({}, { init: { body, signal } });
      await assertSuccessfulResponse(response);
      return response.json();
    },
  });
}

export function updateDocumentMutation(api: ApiClient) {
  return mutationOptions({
    mutationFn: async ({ id, metadata }: { id: string; metadata: DocumentMetadataInput }) => {
      const response = await api.documents[":id"].$patch({ param: { id }, json: metadata });
      await assertSuccessfulResponse(response);
      return response.json();
    },
  });
}

export function deleteDocumentMutation(api: ApiClient) {
  return mutationOptions({
    mutationFn: async (id: string) => {
      const response = await api.documents[":id"].$delete({ param: { id } });
      await assertSuccessfulResponse(response);
      return response.json();
    },
  });
}

type AttachmentVariables = { workspaceId: string; documentId: string; attachment: AttachmentInput };
export function attachDocumentMutation(api: ApiClient) {
  return mutationOptions({
    mutationFn: async ({ workspaceId, documentId, attachment }: AttachmentVariables) => {
      const response = await api.workspaces[":workspaceId"].documents[":documentId"].$put({
        param: { workspaceId, documentId },
        json: attachment,
      });
      await assertSuccessfulResponse(response);
      return response.json();
    },
  });
}

export function updateDocumentAttachmentMutation(api: ApiClient) {
  return mutationOptions({
    mutationFn: async ({ workspaceId, documentId, attachment }: AttachmentVariables) => {
      const response = await api.workspaces[":workspaceId"].documents[":documentId"].$patch({
        param: { workspaceId, documentId },
        json: attachment,
      });
      await assertSuccessfulResponse(response);
      return response.json();
    },
  });
}

export function detachDocumentMutation(api: ApiClient) {
  return mutationOptions({
    mutationFn: async ({
      workspaceId,
      documentId,
    }: {
      workspaceId: string;
      documentId: string;
    }) => {
      const response = await api.workspaces[":workspaceId"].documents[":documentId"].$delete({
        param: { workspaceId, documentId },
      });
      await assertSuccessfulResponse(response);
    },
  });
}

export function refreshDocuments(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: documentQueryKeys.all });
}

export function workspaceDocumentsQuery(
  api: ApiClient,
  workspaceId: string,
  query: WorkspaceDocumentsQueryInput = {},
) {
  return queryOptions({
    queryKey: documentQueryKeys.workspaceList(workspaceId, query),
    queryFn: async ({ signal }) => {
      const response = await api.workspaces[":workspaceId"].documents.$get(
        { param: { workspaceId }, query },
        { init: { signal } },
      );
      await assertSuccessfulResponse(response);
      return response.json();
    },
  });
}

export function workspaceDocumentMembershipQuery(api: ApiClient, workspaceId: string) {
  return queryOptions({
    queryKey: documentQueryKeys.membership(workspaceId),
    queryFn: async ({ signal }) => {
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        // eslint-disable-next-line no-await-in-loop -- each page supplies the next cursor.
        const response = await api.workspaces[":workspaceId"].documents.$get(
          { param: { workspaceId }, query: { limit: "100", ...(cursor ? { cursor } : {}) } },
          { init: { signal } },
        );
        // eslint-disable-next-line no-await-in-loop -- validate before consuming the page.
        await assertSuccessfulResponse(response);
        // eslint-disable-next-line no-await-in-loop -- pagination depends on this response.
        const page = await response.json();
        ids.push(...page.items.map(({ document }) => document.id));
        cursor = page.pageInfo.nextCursor;
      } while (cursor);
      return ids;
    },
  });
}
