import { QueryClientProvider } from "@tanstack/react-query";
import { workspaceFixtures } from "@repo/test-utils";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router";

import WorkspaceDetail, { ErrorBoundary } from "./workspace-detail";
import { createQueryClient } from "~/query-client";
import { WorkspaceApiError } from "~/queries/workspaces";
import { mockApi } from "~/test-setup";

const workspace = workspaceFixtures[0]!;
const loaderData = { item: workspace };
const params = { workspaceId: workspace.id };
const workspaceDetailEntries = [`/workspaces/${workspace.id}`];

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}
function renderDetail() {
  return render(
    <MemoryRouter initialEntries={workspaceDetailEntries}>
      <QueryClientProvider client={createQueryClient()}>
        <WorkspaceDetail loaderData={loaderData} params={params} />
        <Location />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

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
