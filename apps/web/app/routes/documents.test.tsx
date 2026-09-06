import { toast } from "sonner";
import { QueryClientProvider } from "@tanstack/react-query";
import { workspaceFixtures } from "@repo/test-utils";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import Documents from "./documents";
import { createQueryClient } from "~/query-client";
import { mockApi } from "~/test-setup";
import { documentFixture, documentPage } from "~/test/document-fixtures";

function renderPage(page = documentPage) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: 60000 } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Documents loaderData={page} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

vi.mock("sonner", () => ({ toast: { success: vi.fn<typeof toast.success>() } }));
const successToast = vi.mocked(toast.success);

beforeEach(() => {
  successToast.mockReset();
  mockApi.use(
    http.get("*/api/documents", () => HttpResponse.json(documentPage)),
    http.get("*/api/documents/:id", () => HttpResponse.json({ item: documentFixture })),
    http.get("*/api/workspaces/:workspaceId/documents", () =>
      HttpResponse.json({ items: [], pageInfo: { nextCursor: null } }),
    ),
  );
});

describe("Documents", () => {
  it("shows the library and empty state", () => {
    const view = renderPage();
    expect(screen.getByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(screen.getByText("Uploaded", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage Research notes" })).toBeInTheDocument();
    view.unmount();
    renderPage({ ...documentPage, items: [] });
    expect(screen.getByRole("heading", { name: "Your library starts here" })).toBeInTheDocument();
  });
  it("paginates and resets the cursor when filters change", async () => {
    const requests: URLSearchParams[] = [];
    mockApi.use(
      http.get("*/api/documents", ({ request }) => {
        const params = new URL(request.url).searchParams;
        requests.push(params);
        return HttpResponse.json({
          ...documentPage,
          items: [
            { ...documentFixture, title: params.has("cursor") ? "Older paper" : "Filtered paper" },
          ],
        });
      }),
    );
    const user = userEvent.setup();
    renderPage({ ...documentPage, pageInfo: { nextCursor: "next" } });
    await user.click(screen.getByRole("button", { name: /Next/ }));
    expect(await screen.findByText("Older paper")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Status"), "ready");
    await user.type(screen.getByLabelText("Workspace tag"), "research");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("Filtered paper")).toBeInTheDocument();
    expect(screen.getByText("Page 1")).toBeInTheDocument();
    expect(requests.at(-1)?.get("cursor")).toBeNull();
    expect(requests.at(-1)?.get("status")).toBe("ready");
  });

  it.each(["empty", "unavailable"] as const)(
    "uploads directly to the library with %s workspaces",
    async (workspaceState) => {
      let requests = 0;
      mockApi.use(
        http.get("*/api/workspaces", () =>
          workspaceState === "empty"
            ? HttpResponse.json({ items: [], pageInfo: { nextCursor: null } })
            : new HttpResponse(null, { status: 503 }),
        ),
        http.post("*/api/documents", async ({ request }) => {
          requests += 1;
          const body = await request.text();
          expect(body).not.toContain('"tags"');
          expect(body).not.toContain('"displayTitle"');
          return HttpResponse.json(
            { document: documentFixture, attachment: null, jobId: "job-one", reused: false },
            { status: 201 },
          );
        }),
      );
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole("button", { name: "Upload PDF" }));
      expect(
        screen.queryByLabelText("Workspace", { selector: "select#upload-workspace" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Workspace tags (optional)")).not.toBeInTheDocument();
      await user.upload(
        screen.getByLabelText("PDF file"),
        new File(["%PDF-1.7"], "paper.pdf", { type: "application/pdf" }),
      );
      const form = screen.getByRole("button", { name: "Upload document" }).closest("form");
      if (!form) throw new Error("Upload form missing");
      // jsdom does not update native file validity when user-event sets input.files.
      fireEvent.submit(form);
      await waitFor(() =>
        expect(successToast).toHaveBeenCalledWith("PDF uploaded to your library."),
      );
      expect(requests).toBe(1);
    },
  );

  it("uploads a PDF to the library and shows reuse", async () => {
    let metadata: unknown;
    mockApi.use(
      http.post("*/api/documents", async ({ request }) => {
        const body = await request.text();
        const metadataPart = body
          .split('name="metadata"')[1]
          ?.split("\r\n\r\n")[1]
          ?.split("\r\n")[0];
        metadata = JSON.parse(metadataPart ?? "null");
        return HttpResponse.json({
          document: documentFixture,
          reused: true,
          attachment: null,
          jobId: null,
        });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Upload PDF" }));
    await user.upload(
      screen.getByLabelText("PDF file"),
      new File(["%PDF-1.7"], "paper.pdf", { type: "application/pdf" }),
    );
    await user.type(screen.getByLabelText("Title (optional)"), "  Paper  ");
    // jsdom does not update native file validity when user-event sets input.files.
    const uploadForm = screen.getByRole("button", { name: "Upload document" }).closest("form");
    if (!uploadForm) throw new Error("Upload form missing");
    fireEvent.submit(uploadForm);
    await waitFor(() =>
      expect(successToast).toHaveBeenCalledWith("Existing document reused in your library."),
    );
    expect(metadata).toEqual({
      title: "Paper",
      description: null,
    });
    expect(await screen.findByRole("heading", { name: "Manage document" })).toBeInTheDocument();
  });

  it("keeps upload values on server rejection and allows uploads without workspaces", async () => {
    mockApi.use(
      http.post("*/api/documents", () =>
        HttpResponse.json({ detail: "The PDF exceeds the size limit." }, { status: 413 }),
      ),
    );
    const user = userEvent.setup();
    const view = renderPage();
    await user.click(screen.getByRole("button", { name: "Upload PDF" }));
    await user.upload(
      screen.getByLabelText("PDF file"),
      new File(["%PDF-1.7"], "paper.pdf", { type: "application/pdf" }),
    );
    await user.type(screen.getByLabelText("Title (optional)"), "Keep me");
    // jsdom does not update native file validity when user-event sets input.files.
    const uploadForm = screen.getByRole("button", { name: "Upload document" }).closest("form");
    if (!uploadForm) throw new Error("Upload form missing");
    fireEvent.submit(uploadForm);
    expect(await screen.findByRole("alert")).toHaveTextContent("The PDF exceeds the size limit.");
    expect(screen.getByLabelText("Title (optional)")).toHaveValue("Keep me");
    view.unmount();
    mockApi.use(
      http.get("*/api/workspaces", () =>
        HttpResponse.json({ items: [], pageInfo: { nextCursor: null } }),
      ),
    );
    renderPage();
    await user.click(screen.getByRole("button", { name: "Upload PDF" }));
    expect(await screen.findByLabelText("PDF file")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Upload document" })).toBeEnabled();
  });

  it("cancels an in-flight upload without retrying it", async () => {
    const started = Promise.withResolvers<void>();
    let requests = 0;
    mockApi.use(
      http.post("*/api/documents", async ({ request }) => {
        requests += 1;
        started.resolve();
        await new Promise<void>((resolve) => {
          if (request.signal.aborted) resolve();
          else request.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return new HttpResponse(null, { status: 408 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Upload PDF" }));
    await user.upload(
      screen.getByLabelText("PDF file"),
      new File(["%PDF-1.7"], "paper.pdf", { type: "application/pdf" }),
    );
    const form = screen.getByRole("button", { name: "Upload document" }).closest("form");
    if (!form) throw new Error("Upload form missing");
    fireEvent.submit(form);
    await started.promise;
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Upload document" })).toBeDisabled(),
    );
    await user.click(screen.getByRole("button", { name: "Cancel upload" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Upload cancelled. Check your document library before retrying",
    );
    expect(requests).toBe(1);
    expect(screen.getByRole("button", { name: "Upload document" })).toBeEnabled();
  });

  it("shows a list failure and retries the same filters", async () => {
    mockApi.use(
      http.get("*/api/documents", () =>
        HttpResponse.json({ detail: "Documents are temporarily unavailable." }, { status: 503 }),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByLabelText("Status"), "ready");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Documents are temporarily unavailable.",
    );
    mockApi.use(
      http.get("*/api/documents", ({ request }) => {
        expect(new URL(request.url).searchParams.get("status")).toBe("ready");
        return HttpResponse.json(documentPage);
      }),
    );
    await user.click(screen.getByRole("button", { name: "Retry documents" }));
    expect(
      await screen.findByRole("button", { name: "Manage Research notes" }),
    ).toBeInTheDocument();
  });

  it("edits metadata, reports deletion conflicts, and retains deleting documents", async () => {
    let item = documentFixture;
    mockApi.use(
      http.get("*/api/documents/:id", () => HttpResponse.json({ item })),
      http.patch("*/api/documents/:id", async ({ request }) => {
        const changes: unknown = await request.json();
        if (
          !changes ||
          typeof changes !== "object" ||
          !("title" in changes) ||
          typeof changes.title !== "string"
        )
          throw new Error("Expected title");
        item = { ...item, title: changes.title };
        return HttpResponse.json({ item });
      }),
      http.delete("*/api/documents/:id", () =>
        HttpResponse.json(
          {
            code: "DOCUMENT_ATTACHED",
            detail: "Detach this document from every workspace before deleting it.",
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Manage Research notes" }));
    const title = await screen.findByLabelText("Title (optional)");
    await user.clear(title);
    await user.type(title, "Revised notes");
    await user.click(screen.getByRole("button", { name: "Save metadata" }));
    await waitFor(() => expect(successToast).toHaveBeenCalledWith("Document metadata saved."));
    await user.click(screen.getByRole("button", { name: "Request deletion" }));
    await user.click(screen.getByRole("button", { name: "Confirm deletion" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Detach this document from every workspace",
    );
    mockApi.use(
      http.delete("*/api/documents/:id", () => {
        item = { ...item, status: "deleting" };
        return HttpResponse.json({ item }, { status: 202 });
      }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm deletion" }));
    expect(
      await screen.findByText("Deletion requested. This document is awaiting removal."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request deletion" })).toBeDisabled();
    await waitFor(() => expect(successToast).toHaveBeenCalledWith("Document deletion requested."));
  });

  it("attaches, updates tags, and detaches an existing document", async () => {
    let attached = false;
    let tags: string[] = [];
    const attachment = () => ({
      documentId: documentFixture.id,
      workspaceId: workspaceFixtures[0]!.id,
      displayTitle: null,
      tags,
      attachedAt: documentFixture.createdAt,
      updatedAt: tags.join(","),
    });
    mockApi.use(
      http.get("*/api/workspaces/:workspaceId/documents", () =>
        HttpResponse.json({
          items: attached ? [{ document: documentFixture, attachment: attachment() }] : [],
          pageInfo: { nextCursor: null },
        }),
      ),
      http.put("*/api/workspaces/:workspaceId/documents/:documentId", () => {
        attached = true;
        return HttpResponse.json({ item: attachment() });
      }),
      http.patch("*/api/workspaces/:workspaceId/documents/:documentId", async ({ request }) => {
        const body: unknown = await request.json();
        if (!body || typeof body !== "object" || !("tags" in body) || !Array.isArray(body.tags))
          throw new Error("Expected tags");
        tags = body.tags.filter((tag): tag is string => typeof tag === "string");
        return HttpResponse.json({ item: attachment() });
      }),
      http.delete("*/api/workspaces/:workspaceId/documents/:documentId", () => {
        attached = false;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Manage Research notes" }));
    await user.selectOptions(
      await screen.findByLabelText("Workspace to manage"),
      workspaceFixtures[0]!.id,
    );
    await user.click(await screen.findByRole("button", { name: "Attach to workspace" }));
    expect(await screen.findByText("Attached to this workspace")).toBeInTheDocument();
    await waitFor(() =>
      expect(successToast).toHaveBeenCalledWith("Document attached to workspace."),
    );
    await user.type(screen.getByLabelText("Tags"), "research");
    await user.click(screen.getByRole("button", { name: "Save workspace details" }));
    await waitFor(() => expect(tags).toEqual(["research"]));
    await waitFor(() => expect(successToast).toHaveBeenCalledWith("Workspace details saved."));
    await user.click(screen.getByRole("button", { name: "Detach from workspace" }));
    expect(await screen.findByText("Not attached to this workspace")).toBeInTheDocument();
    await waitFor(() =>
      expect(successToast).toHaveBeenCalledWith("Document detached. It remains in your library."),
    );
    expect(within(screen.getByRole("dialog")).getByText("Research notes")).toBeInTheDocument();
  });
});
