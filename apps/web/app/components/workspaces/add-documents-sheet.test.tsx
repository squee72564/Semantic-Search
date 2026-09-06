import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { mockApi } from "~/test-setup";
import {
  documentPage,
  readyDocumentFixture,
  workspaceDocumentFixture,
  workspaceDocumentPage,
} from "~/test/document-fixtures";
import { AddDocumentsSheet } from "./add-documents-sheet";

const workspaceId = workspaceDocumentFixture.attachment.workspaceId;
function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AddDocumentsSheet workspaceId={workspaceId} onClose={vi.fn<() => void>()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}

describe("Add workspace documents", () => {
  it("checks every membership page and marks existing attachments", async () => {
    const cursors: Array<string | null> = [];
    mockApi.use(
      http.get("*/api/documents", ({ request }) => {
        expect(new URL(request.url).searchParams.get("status")).toBe("ready");
        return HttpResponse.json({ ...documentPage, items: [readyDocumentFixture] });
      }),
      http.get("*/api/workspaces/:workspaceId/documents", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        cursors.push(cursor);
        return HttpResponse.json(
          cursor ? workspaceDocumentPage : { items: [], pageInfo: { nextCursor: "next" } },
        );
      }),
    );
    renderSheet();
    expect(
      await screen.findByRole("button", { name: "Research notes already attached" }),
    ).toBeDisabled();
    expect(cursors).toEqual([null, "next"]);
  });

  it("adds with empty metadata, prevents duplicate requests, and keeps the sheet open", async () => {
    let attached = false;
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const requests = vi.fn<() => void>();
    mockApi.use(
      http.get("*/api/documents", () =>
        HttpResponse.json({ ...documentPage, items: [readyDocumentFixture] }),
      ),
      http.get("*/api/workspaces/:workspaceId/documents", () =>
        HttpResponse.json({
          ...workspaceDocumentPage,
          items: attached ? [workspaceDocumentFixture] : [],
        }),
      ),
      http.put("*/api/workspaces/:workspaceId/documents/:documentId", async ({ request }) => {
        requests();
        expect(await request.json()).toEqual({});
        started.resolve();
        await finish.promise;
        attached = true;
        return HttpResponse.json({ item: workspaceDocumentFixture.attachment });
      }),
    );
    const user = userEvent.setup();
    renderSheet();
    const add = await screen.findByRole("button", { name: "Add Research notes" });
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);
    await started.promise;
    expect(add).toBeDisabled();
    await user.click(add);
    expect(requests).toHaveBeenCalledTimes(1);
    finish.resolve();
    expect(
      await screen.findByRole("button", { name: "Research notes already attached" }),
    ).toBeDisabled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("blocks Add when membership fails and recovers through Retry", async () => {
    mockApi.use(
      http.get("*/api/documents", () =>
        HttpResponse.json({ ...documentPage, items: [readyDocumentFixture] }),
      ),
      http.get("*/api/workspaces/:workspaceId/documents", () =>
        HttpResponse.json({ detail: "Cannot check attachments." }, { status: 503 }),
      ),
    );
    const user = userEvent.setup();
    renderSheet();
    expect(await screen.findByText("Cannot check attachments.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Research notes" })).toBeDisabled();
    mockApi.use(
      http.get("*/api/workspaces/:workspaceId/documents", () =>
        HttpResponse.json({ ...workspaceDocumentPage, items: [] }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Retry attachments" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add Research notes" })).toBeEnabled(),
    );
  });

  it("keeps failed attachment actions retryable", async () => {
    mockApi.use(
      http.get("*/api/documents", () =>
        HttpResponse.json({ ...documentPage, items: [readyDocumentFixture] }),
      ),
      http.get("*/api/workspaces/:workspaceId/documents", () =>
        HttpResponse.json({ ...workspaceDocumentPage, items: [] }),
      ),
      http.put("*/api/workspaces/:workspaceId/documents/:documentId", () =>
        HttpResponse.json({ detail: "Unable to attach." }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    renderSheet();
    const add = await screen.findByRole("button", { name: "Add Research notes" });
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to attach.");
    expect(add).toBeEnabled();
  });

  it("keeps ready-only search through pagination and retry, then resets it", async () => {
    const requests: URLSearchParams[] = [];
    let failSearchedPage = true;
    mockApi.use(
      http.get("*/api/documents", ({ request }) => {
        const params = new URL(request.url).searchParams;
        requests.push(new URLSearchParams(params));
        if (params.get("search") === "coastal report" && params.has("cursor") && failSearchedPage) {
          failSearchedPage = false;
          return HttpResponse.json({ detail: "Search unavailable." }, { status: 503 });
        }
        return HttpResponse.json({
          ...documentPage,
          items: [readyDocumentFixture],
          pageInfo: {
            nextCursor: params.has("cursor") ? null : params.has("search") ? "search-next" : "next",
          },
        });
      }),
      http.get("*/api/workspaces/:workspaceId/documents", () =>
        HttpResponse.json({ ...workspaceDocumentPage, items: [] }),
      ),
    );
    const user = userEvent.setup();
    renderSheet();
    await screen.findByText("Research notes");
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() => expect(requests.at(-1)?.get("cursor")).toBe("next"));
    await user.type(screen.getByLabelText("Search documents"), "  coastal report  {enter}");
    await waitFor(() => expect(requests.at(-1)?.get("search")).toBe("coastal report"));
    expect(requests.at(-1)?.has("cursor")).toBe(false);
    expect(screen.getByText("Page 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Next/ }));
    expect(await screen.findByText("Search unavailable.")).toBeInTheDocument();
    expect(requests.at(-1)?.get("search")).toBe("coastal report");
    expect(requests.at(-1)?.get("cursor")).toBe("search-next");
    await user.click(screen.getByRole("button", { name: "Retry documents" }));
    await waitFor(() => expect(screen.queryByText("Search unavailable.")).not.toBeInTheDocument());
    expect(requests.at(-1)?.get("search")).toBe("coastal report");
    expect(requests.at(-1)?.get("cursor")).toBe("search-next");

    await user.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(requests.at(-1)?.has("search")).toBe(false));
    expect(requests.at(-1)?.has("cursor")).toBe(false);
    expect(screen.getByLabelText("Search documents")).toHaveValue("");
    expect(requests.every((params) => params.get("status") === "ready")).toBe(true);
    expect(requests.every((params) => !params.has("tag") && !params.has("workspaceId"))).toBe(true);
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });

  it("explains an empty searched result and preserves the unfiltered empty state", async () => {
    mockApi.use(
      http.get("*/api/documents", () =>
        HttpResponse.json({ ...documentPage, items: [], pageInfo: { nextCursor: null } }),
      ),
      http.get("*/api/workspaces/:workspaceId/documents", () =>
        HttpResponse.json({ ...workspaceDocumentPage, items: [] }),
      ),
    );
    const user = userEvent.setup();
    renderSheet();

    expect(await screen.findByText("No ready documents")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Search documents"), "missing title");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("No matching ready documents")).toBeInTheDocument();
    expect(
      screen.getByText("Try another title or filename, or reset the search."),
    ).toBeInTheDocument();
  });
});
