import { QueryClientProvider } from "@tanstack/react-query";
import { workspaceFixtures } from "@repo/test-utils";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router";

import WorkspaceDetail, { ErrorBoundary } from "./workspace-detail";
import { createQueryClient } from "~/query-client";
import { WorkspaceApiError } from "~/queries/workspaces";
import { mockApi } from "~/test-setup";

import {
  workspaceDocumentFixture,
  workspaceDocumentPage,
  readyDocumentFixture,
} from "~/test/document-fixtures";

const workspace = workspaceFixtures[0]!;
const loaderData = { item: workspace };
const params = { workspaceId: workspace.id };
const workspaceDetailEntries = [`/workspaces/${workspace.id}`];

const nextWorkspace = {
  ...workspace,
  id: "33333333-3333-4333-8333-333333333333",
  name: "Next workspace",
};
const nextLoaderData = { item: nextWorkspace };
const nextParams = { workspaceId: nextWorkspace.id };

function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}
function renderDetail(entries = workspaceDetailEntries) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: 60000 } });
  return render(
    <MemoryRouter initialEntries={entries}>
      <QueryClientProvider client={client}>
        <WorkspaceDetail loaderData={loaderData} params={params} />
        <Location />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockApi.use(
    http.get("*/api/workspaces/:workspaceId/documents", () =>
      HttpResponse.json({ ...workspaceDocumentPage, items: [] }),
    ),
  );
});

describe("Workspace detail", () => {
  it("renders workspace metadata", () => {
    renderDetail();
    expect(screen.getByRole("heading", { level: 1, name: workspace.name })).toBeInTheDocument();
    expect(screen.getByText(workspace.description!)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Workspaces/ })).toHaveAttribute("href", "/workspaces");
  });

  it("updates the name and description", async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole("button", { name: /Edit/ }));
    const name = screen.getByLabelText("Name");
    const description = screen.getByLabelText(/Description/);
    await user.clear(name);
    await user.type(name, "Renamed research");
    await user.clear(description);
    await user.type(description, "Updated context");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Renamed research" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Updated context")).toBeInTheDocument();
  });

  it("cancels deletion without issuing a request", async () => {
    const deleted = vi.fn<() => void>();
    mockApi.use(
      http.delete("*/workspaces/:id", () => {
        deleted();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole("button", { name: /Delete/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleted).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: workspace.name })).toBeInTheDocument();
  });

  it("deletes and returns to the directory", async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole("button", { name: /Delete/ }));
    await user.click(screen.getByRole("button", { name: "Delete workspace" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/workspaces"));
  });

  it("shows the workspace-specific not-found state", () => {
    render(
      <MemoryRouter>
        <ErrorBoundary error={new WorkspaceApiError(404)} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Workspace not found" })).toBeInTheDocument();
    expect(screen.getByText(/do not have access/)).toBeInTheDocument();
  });

  it("keeps edit values visible after an API failure", async () => {
    mockApi.use(http.patch("*/workspaces/:id", () => HttpResponse.json({}, { status: 500 })));
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole("button", { name: /Edit/ }));
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Keep this rename");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace API returned 500");
    expect(name).toHaveValue("Keep this rename");
  });
});

describe("Workspace document hub", () => {
  it("links to Chats with an honest disabled action and preserves document filters", async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.selectOptions(screen.getByLabelText("Status"), "failed");
    await user.type(screen.getByLabelText("Workspace tag"), "research");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await user.click(screen.getByRole("tab", { name: "Chats" }));
    expect(screen.getByRole("button", { name: "New chat" })).toBeDisabled();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("?tab=chats");
    await user.click(screen.getByRole("tab", { name: "Documents" }));
    expect(screen.getByLabelText("Status")).toHaveValue("failed");
    expect(screen.getByLabelText("Workspace tag")).toHaveValue("research");
  });

  it("opens Chats directly without fetching documents", () => {
    const requested = vi.fn<() => void>();
    mockApi.use(
      http.get("*/api/workspaces/:workspaceId/documents", () => {
        requested();
        return HttpResponse.json(workspaceDocumentPage);
      }),
    );
    renderDetail([`${workspaceDetailEntries[0]}?tab=chats`]);
    expect(screen.getByRole("tab", { name: "Chats" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "New chat" })).toBeDisabled();
    expect(requested).not.toHaveBeenCalled();
  });

  it("retains the deletion dialog on failure", async () => {
    mockApi.use(http.delete("*/workspaces/:id", () => HttpResponse.json({}, { status: 500 })));
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete workspace" }));
    expect(await within(screen.getByRole("alertdialog")).findByRole("alert")).toHaveTextContent(
      "Workspace API returned 500",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("edits attachment metadata and detaches without deleting the library document", async () => {
    let item = workspaceDocumentFixture;
    let attached = true;
    mockApi.use(
      http.get("*/api/workspaces/:workspaceId/documents", () =>
        HttpResponse.json({ ...workspaceDocumentPage, items: attached ? [item] : [] }),
      ),
      http.patch("*/api/workspaces/:workspaceId/documents/:documentId", async ({ request }) => {
        expect(await request.json()).toEqual({
          displayTitle: "Local title",
          tags: ["research", "updated"],
        });
        item = {
          ...item,
          attachment: {
            ...item.attachment,
            displayTitle: "Local title",
            tags: ["research", "updated"],
          },
        };
        return HttpResponse.json({ item: item.attachment });
      }),
      http.delete("*/api/workspaces/:workspaceId/documents/:documentId", () => {
        attached = false;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderDetail();
    expect(await screen.findByText("Workspace research")).toBeInTheDocument();
    expect(screen.getByText("Ready", { selector: "span" })).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Edit workspace details for Workspace research" }),
    );
    await user.clear(screen.getByLabelText("Workspace display title"));
    await user.type(screen.getByLabelText("Workspace display title"), "Local title");
    await user.type(screen.getByLabelText("Tags"), ", updated");
    await user.click(screen.getByRole("button", { name: "Save workspace details" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Local title")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Detach Local title" }));
    expect(await screen.findByText("Add your first document")).toBeInTheDocument();
  });

  it("paginates attachments and applies server filters from page one", async () => {
    const requests: URLSearchParams[] = [];
    mockApi.use(
      http.get("*/api/workspaces/:workspaceId/documents", ({ request }) => {
        const query = new URL(request.url).searchParams;
        requests.push(query);
        return HttpResponse.json({
          ...workspaceDocumentPage,
          pageInfo: { nextCursor: query.has("cursor") ? null : "next" },
        });
      }),
    );
    const user = userEvent.setup();
    renderDetail();
    await screen.findByText("Workspace research");
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() => expect(requests.at(-1)?.get("cursor")).toBe("next"));
    await user.selectOptions(screen.getByLabelText("Status"), "ready");
    await user.type(screen.getByLabelText("Workspace tag"), "research");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(requests.at(-1)?.get("tag")).toBe("research"));
    expect(requests.at(-1)?.get("status")).toBe("ready");
    expect(requests.at(-1)?.has("cursor")).toBe(false);
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });

  it("retains attachment rows on refresh and mutation failures", async () => {
    mockApi.use(
      http.get("*/api/workspaces/:workspaceId/documents", () =>
        HttpResponse.json(workspaceDocumentPage),
      ),
      http.delete("*/api/workspaces/:workspaceId/documents/:documentId", () =>
        HttpResponse.json({ detail: "Unable to detach." }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    renderDetail();
    await user.click(await screen.findByRole("button", { name: "Detach Workspace research" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to detach.");
    expect(screen.getByText("Workspace research")).toBeInTheDocument();
    mockApi.use(
      http.get("*/api/workspaces/:workspaceId/documents", () =>
        HttpResponse.json({ detail: "Refresh failed." }, { status: 503 }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Refresh documents" }));
    expect(await screen.findByText("Refresh failed.")).toBeInTheDocument();
    expect(screen.getByText("Workspace research")).toBeInTheDocument();
  });
});

describe("Workspace accessibility and failures", () => {
  it("supports keyboard tab navigation and invalid-tab fallback", async () => {
    const user = userEvent.setup();
    renderDetail([`${workspaceDetailEntries[0]}?tab=unknown`]);
    const documentsTab = screen.getByRole("tab", { name: "Documents" });
    expect(documentsTab).toHaveAttribute("aria-selected", "true");
    documentsTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Chats" })).toHaveFocus();
    expect(await screen.findByRole("button", { name: "New chat" })).toBeDisabled();
    await user.keyboard("{ArrowLeft}");
    expect(documentsTab).toHaveFocus();
  });

  it("returns focus to the library picker trigger on Escape", async () => {
    mockApi.use(
      http.get("*/api/documents", () =>
        HttpResponse.json({ items: [], pageInfo: { nextCursor: null } }),
      ),
    );
    const user = userEvent.setup();
    renderDetail();
    const trigger = screen.getByRole("button", { name: "Add documents" });
    await user.click(trigger);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("preserves attachment edit values on failure and restores trigger focus", async () => {
    mockApi.use(
      http.get("*/api/workspaces/:workspaceId/documents", () =>
        HttpResponse.json(workspaceDocumentPage),
      ),
      http.patch("*/api/workspaces/:workspaceId/documents/:documentId", () =>
        HttpResponse.json({ detail: "Unable to save tags." }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    renderDetail();
    const trigger = await screen.findByRole("button", {
      name: "Edit workspace details for Workspace research",
    });
    await user.click(trigger);
    await user.type(screen.getByLabelText("Tags"), ", retain-me");
    await user.click(screen.getByRole("button", { name: "Save workspace details" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save tags.");
    expect(screen.getByLabelText("Tags")).toHaveValue("research, retain-me");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows filename fallback and non-ready attachments", async () => {
    mockApi.use(
      http.get("*/api/workspaces/:workspaceId/documents", () =>
        HttpResponse.json({
          ...workspaceDocumentPage,
          items: [
            {
              document: { ...workspaceDocumentFixture.document, title: null, status: "processing" },
              attachment: { ...workspaceDocumentFixture.attachment, displayTitle: null },
            },
          ],
        }),
      ),
    );
    renderDetail();
    expect(await screen.findByRole("heading", { name: "research.pdf" })).toBeInTheDocument();
    expect(screen.getByText("Processing", { selector: "span" })).toBeInTheDocument();
  });

  it("retries an initial document failure without losing workspace metadata", async () => {
    mockApi.use(
      http.get("*/api/workspaces/:workspaceId/documents", () =>
        HttpResponse.json({ detail: "Documents unavailable." }, { status: 503 }),
      ),
    );
    const user = userEvent.setup();
    renderDetail();
    expect(await screen.findByRole("alert")).toHaveTextContent("Documents unavailable.");
    expect(screen.getByRole("heading", { level: 1, name: workspace.name })).toBeInTheDocument();
    mockApi.use(
      http.get("*/api/workspaces/:workspaceId/documents", () =>
        HttpResponse.json(workspaceDocumentPage),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Retry documents" }));
    expect(await screen.findByText("Workspace research")).toBeInTheDocument();
  });
});

describe("Workspace state isolation", () => {
  it("resets filters and open sheets when the workspace changes", async () => {
    const user = userEvent.setup();
    const client = createQueryClient();
    const view = render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <WorkspaceDetail loaderData={loaderData} params={params} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await user.selectOptions(screen.getByLabelText("Status"), "failed");
    await user.type(screen.getByLabelText("Workspace tag"), "research");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    view.rerender(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <WorkspaceDetail loaderData={nextLoaderData} params={nextParams} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Next workspace" })).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toHaveValue("");
    expect(screen.getByLabelText("Workspace tag")).toHaveValue("");
  });

  it("refreshes attached documents after adding from the library", async () => {
    let attached = false;
    mockApi.use(
      http.get("*/api/documents", () =>
        HttpResponse.json({
          items: [readyDocumentFixture],
          limit: 20,
          pageInfo: { nextCursor: null },
        }),
      ),
      http.get("*/api/workspaces/:workspaceId/documents", () =>
        HttpResponse.json({
          ...workspaceDocumentPage,
          items: attached ? [workspaceDocumentFixture] : [],
        }),
      ),
      http.put("*/api/workspaces/:workspaceId/documents/:documentId", () => {
        attached = true;
        return HttpResponse.json({ item: workspaceDocumentFixture.attachment });
      }),
    );
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole("button", { name: "Add documents" }));
    const add = await screen.findByRole("button", { name: "Add Research notes" });
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);
    await screen.findByRole("button", { name: "Research notes already attached" });
    await user.keyboard("{Escape}");
    expect(await screen.findByText("Workspace research")).toBeInTheDocument();
  });
});
