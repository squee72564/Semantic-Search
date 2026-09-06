// @vitest-environment node
import { createApiClient } from "@repo/api/client";
import { QueryClient, MutationObserver } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  workspaceDocumentsQuery,
  workspaceDocumentMembershipQuery,
  documentQueryKeys,
  refreshDocuments,
  attachDocumentMutation,
  deleteDocumentMutation,
  detachDocumentMutation,
  documentAttachmentQuery,
  documentQuery,
  documentsQuery,
  updateDocumentAttachmentMutation,
  updateDocumentMutation,
  uploadDocumentMutation,
} from "./documents";
import { mockApi } from "~/test-setup";
import { documentFixture, documentPage, workspaceDocumentPage } from "~/test/document-fixtures";

const browserApiClient = createApiClient("http://localhost:3000/api");

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe("document API queries", () => {
  it("streams a multipart library upload without a workspace", async () => {
    mockApi.use(
      http.post("*/api/documents", async ({ request }) => {
        expect(request.headers.get("content-type")).toMatch(/multipart\/form-data; boundary=/);
        const form = await request.formData();
        const file = form.get("file");
        expect(file).toBeInstanceOf(File);
        if (!(file instanceof File)) throw new Error("Missing file");
        expect(file.name).toBe("paper.pdf");
        expect(await file.text()).toBe("%PDF-1.7");
        expect(form.get("metadata")).toBe('{"title":"Paper"}');
        return HttpResponse.json(
          { document: documentFixture, attachment: null, jobId: "job", reused: false },
          { status: 201 },
        );
      }),
    );
    const observer = new MutationObserver(client(), uploadDocumentMutation(browserApiClient));
    await expect(
      observer.mutate({
        file: new File(["%PDF-1.7"], "paper.pdf", { type: "application/pdf" }),
        metadata: { title: "Paper" },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ attachment: null, reused: false });
  });

  it("sends list filters, isolates searches in cache, and reads a document detail", async () => {
    mockApi.use(
      http.get("*/api/documents", ({ request }) => {
        const params = new URL(request.url).searchParams;
        expect(params.get("workspaceId")).toBe("workspace-one");
        expect(params.get("status")).toBe("ready");
        expect(params.get("tag")).toBe("research");
        expect(params.get("search")).toBe("coastal");
        expect(params.get("cursor")).toBe("page-two");
        return HttpResponse.json(documentPage);
      }),
      http.get("*/api/documents/:id", () => HttpResponse.json({ item: documentFixture })),
    );
    const cache = client();
    expect(
      await cache.fetchQuery(
        documentsQuery(browserApiClient, {
          workspaceId: "workspace-one",
          status: "ready",
          tag: "research",
          search: "coastal",
          cursor: "page-two",
        }),
      ),
    ).toEqual(documentPage);
    expect(
      cache.getQueryData(documentsQuery(browserApiClient, { search: "inland" }).queryKey),
    ).toBeUndefined();
    expect(await cache.fetchQuery(documentQuery(browserApiClient, documentFixture.id))).toEqual({
      item: documentFixture,
    });
  });

  it("finds attachments beyond the first workspace page", async () => {
    const cursors: Array<string | null> = [];
    mockApi.use(
      http.get("*/api/workspaces/:workspaceId/documents", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        cursors.push(cursor);
        return HttpResponse.json(
          cursor
            ? {
                items: [
                  {
                    document: documentFixture,
                    attachment: { documentId: documentFixture.id, tags: ["research"] },
                  },
                ],
                pageInfo: { nextCursor: null },
              }
            : { items: [], pageInfo: { nextCursor: "next" } },
        );
      }),
    );
    expect(
      await client().fetchQuery(
        documentAttachmentQuery(browserApiClient, "workspace-one", documentFixture.id),
      ),
    ).toMatchObject({ tags: ["research"] });
    expect(cursors).toEqual([null, "next"]);
  });

  it("sends metadata, attachment updates and bodyless detach requests", async () => {
    const requests: string[] = [];
    mockApi.use(
      http.patch("*/api/documents/:id", async ({ request }) => {
        expect(await request.json()).toEqual({ title: "Renamed" });
        requests.push("metadata");
        return HttpResponse.json({ item: { ...documentFixture, title: "Renamed" } });
      }),
      http.put("*/api/workspaces/:workspaceId/documents/:documentId", async ({ request }) => {
        expect(await request.json()).toEqual({ tags: ["research"] });
        requests.push("attach");
        return HttpResponse.json({ item: {} });
      }),
      http.patch("*/api/workspaces/:workspaceId/documents/:documentId", async ({ request }) => {
        expect(await request.json()).toEqual({ tags: ["updated"] });
        requests.push("attachment");
        return HttpResponse.json({ item: {} });
      }),
      http.delete("*/api/workspaces/:workspaceId/documents/:documentId", () => {
        requests.push("detach");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const cache = client();
    await new MutationObserver(cache, updateDocumentMutation(browserApiClient)).mutate({
      id: documentFixture.id,
      metadata: { title: "Renamed" },
    });
    await new MutationObserver(cache, attachDocumentMutation(browserApiClient)).mutate({
      workspaceId: "one",
      documentId: documentFixture.id,
      attachment: { tags: ["research"] },
    });
    await new MutationObserver(cache, updateDocumentAttachmentMutation(browserApiClient)).mutate({
      workspaceId: "one",
      documentId: documentFixture.id,
      attachment: { tags: ["updated"] },
    });
    await new MutationObserver(cache, detachDocumentMutation(browserApiClient)).mutate({
      workspaceId: "one",
      documentId: documentFixture.id,
    });
    expect(requests).toEqual(["metadata", "attach", "attachment", "detach"]);
  });

  it("surfaces public deletion conflicts and preserves accepted deletion status", async () => {
    mockApi.use(
      http.delete("*/api/documents/:id", () =>
        HttpResponse.json(
          {
            detail: "Detach this document from every workspace before deleting it.",
            code: "DOCUMENT_ATTACHED",
          },
          { status: 409 },
        ),
      ),
    );
    const observer = new MutationObserver(client(), deleteDocumentMutation(browserApiClient));
    await expect(observer.mutate(documentFixture.id)).rejects.toMatchObject({
      status: 409,
      code: "DOCUMENT_ATTACHED",
      message: "Detach this document from every workspace before deleting it.",
    });
    mockApi.use(
      http.delete("*/api/documents/:id", () =>
        HttpResponse.json({ item: { ...documentFixture, status: "deleting" } }, { status: 202 }),
      ),
    );
    await expect(observer.mutate(documentFixture.id)).resolves.toMatchObject({
      item: { status: "deleting" },
    });
  });

  it("posts a real multipart file and metadata with a generated boundary", async () => {
    mockApi.use(
      http.post("*/api/documents", async ({ request }) => {
        expect(request.headers.get("content-type")).toContain("multipart/form-data; boundary=");
        const body = await request.text();
        expect(body).toContain('name="file"; filename="paper.pdf"');
        expect(body).toContain("Content-Type: application/pdf");
        expect(body).toContain("%PDF-1.7");
        expect(body).toContain(JSON.stringify({ title: "Paper" }));
        return HttpResponse.json(
          { document: documentFixture, reused: false, jobId: null, attachment: null },
          { status: 201 },
        );
      }),
    );
    const observer = new MutationObserver(client(), uploadDocumentMutation(browserApiClient));
    await expect(
      observer.mutate({
        file: new File(["%PDF-1.7"], "paper.pdf", { type: "application/pdf" }),
        metadata: { title: "Paper" },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ reused: false });
  });
});

describe("workspace document queries", () => {
  it("sends workspace filters and keeps cache entries isolated", async () => {
    mockApi.use(
      http.get("*/api/workspaces/:workspaceId/documents", ({ request, params }) => {
        expect(params.workspaceId).toBe("one");
        const query = new URL(request.url).searchParams;
        expect(query.get("status")).toBe("ready");
        expect(query.get("tag")).toBe("research");
        expect(query.get("cursor")).toBe("next");
        return HttpResponse.json(workspaceDocumentPage);
      }),
    );
    const cache = client();
    const options = workspaceDocumentsQuery(browserApiClient, "one", {
      status: "ready",
      tag: "research",
      cursor: "next",
    });
    expect(await cache.fetchQuery(options)).toEqual(workspaceDocumentPage);
    expect(
      cache.getQueryData(workspaceDocumentsQuery(browserApiClient, "two", {}).queryKey),
    ).toBeUndefined();
    cache.setQueryData(documentQueryKeys.membership("one"), [documentFixture.id]);
    await refreshDocuments(cache);
    expect(cache.getQueryState(options.queryKey)?.isInvalidated).toBe(true);
    expect(cache.getQueryState(documentQueryKeys.membership("one"))?.isInvalidated).toBe(true);
  });

  it("collects all membership pages and rejects partial results", async () => {
    let fail = false;
    const cursors: Array<string | null> = [];
    mockApi.use(
      http.get("*/api/workspaces/:workspaceId/documents", ({ request }) => {
        const query = new URL(request.url).searchParams;
        expect(query.get("limit")).toBe("100");
        expect(query.has("status")).toBe(false);
        const cursor = query.get("cursor");
        cursors.push(cursor);
        if (cursor && fail)
          return HttpResponse.json({ detail: "Membership unavailable." }, { status: 503 });
        return HttpResponse.json(
          cursor ? workspaceDocumentPage : { items: [], pageInfo: { nextCursor: "next" } },
        );
      }),
    );
    expect(
      await client().fetchQuery(workspaceDocumentMembershipQuery(browserApiClient, "one")),
    ).toEqual([documentFixture.id]);
    expect(cursors).toEqual([null, "next"]);
    fail = true;
    const cache = client();
    const options = workspaceDocumentMembershipQuery(browserApiClient, "one");
    await expect(cache.fetchQuery(options)).rejects.toMatchObject({
      status: 503,
      message: "Membership unavailable.",
    });
    expect(cache.getQueryData(options.queryKey)).toBeUndefined();
  });

  it.each(["list", "membership"])("aborts an in-flight %s request", async (kind) => {
    const started = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    mockApi.use(
      http.get("*/api/workspaces/:workspaceId/documents", async ({ request }) => {
        started.resolve();
        await new Promise<void>((resolve) => {
          request.signal.addEventListener(
            "abort",
            () => {
              aborted.resolve();
              resolve();
            },
            { once: true },
          );
        });
        return new HttpResponse(null, { status: 408 });
      }),
    );
    const cache = client();
    const promise =
      kind === "list"
        ? cache.fetchQuery(workspaceDocumentsQuery(browserApiClient, "one"))
        : cache.fetchQuery(workspaceDocumentMembershipQuery(browserApiClient, "one"));
    const settled = promise.catch(() => undefined);
    await started.promise;
    await cache.cancelQueries({ queryKey: documentQueryKeys.workspace("one") });
    await aborted.promise;
    await settled;
    expect(cache.isFetching({ queryKey: documentQueryKeys.workspace("one") })).toBe(0);
  });
});
