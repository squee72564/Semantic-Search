import { QueryClientProvider } from "@tanstack/react-query";
import { workspaceFixtures } from "@repo/test-utils";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router";

import Workspaces from "./workspaces";
import { createQueryClient } from "~/query-client";
import { mockApi } from "~/test-setup";

const page: {
  items: typeof workspaceFixtures;
  limit: number;
  pageInfo: { nextCursor: string | null };
} = { items: workspaceFixtures, limit: 20, pageInfo: { nextCursor: null } };
const workspaceEntries = ["/workspaces"];

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}
function renderPage(loaderData = page) {
  return render(
    <MemoryRouter initialEntries={workspaceEntries}>
      <QueryClientProvider client={createQueryClient()}>
        <Workspaces loaderData={loaderData} />
        <Location />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Workspaces", () => {
  it("renders cards and an empty state", () => {
    const view = renderPage();
    expect(screen.getByRole("link", { name: /Research library/ })).toHaveAttribute(
      "href",
      `/workspaces/${workspaceFixtures[0]!.id}`,
    );
    view.unmount();
    renderPage({ ...page, items: [] });
    expect(
      screen.getByRole("heading", { name: "Create your first workspace" }),
    ).toBeInTheDocument();
  });

  it("creates a workspace, normalizes an empty description, and navigates", async () => {
    let submitted: unknown;
    mockApi.use(
      http.post("*/workspaces", async ({ request }) => {
        submitted = await request.json();
        return HttpResponse.json({ item: workspaceFixtures[0] }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /Create workspace/ }));
    await user.type(screen.getByLabelText("Name"), "  New workspace  ");
    await user.type(screen.getByLabelText(/Description/), "   ");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/workspaces/${workspaceFixtures[0]!.id}`,
      ),
    );
    expect(submitted).toEqual({ name: "New workspace", description: null });
  });

  it("preserves form values and shows API errors", async () => {
    mockApi.use(http.post("*/workspaces", () => HttpResponse.json({}, { status: 500 })));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /Create workspace/ }));
    await user.type(screen.getByLabelText("Name"), "Keep me");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace API returned 500");
    expect(screen.getByLabelText("Name")).toHaveValue("Keep me");
  });

  it("navigates through cursor pages", async () => {
    const user = userEvent.setup();
    mockApi.use(
      http.get("*/workspaces", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        return HttpResponse.json(
          cursor
            ? {
                items: [workspaceFixtures[1]],
                limit: 20,
                pageInfo: { nextCursor: null },
              }
            : page,
        );
      }),
    );
    renderPage({ ...page, pageInfo: { nextCursor: "next-page" } });
    await user.click(screen.getByRole("button", { name: /Next/ }));
    expect(await screen.findByText("Product planning")).toBeInTheDocument();
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Previous/ }));
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });
});
