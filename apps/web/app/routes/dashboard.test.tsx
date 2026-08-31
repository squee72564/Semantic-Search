import { QueryClientProvider } from "@tanstack/react-query";
import { workspaceFixtures } from "@repo/test-utils";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import Dashboard from "./dashboard.js";
import { createQueryClient } from "~/query-client";

const dashboardData = {
  items: workspaceFixtures,
  limit: 4,
  pageInfo: { hasMore: false, nextCursor: null },
};
const emptyDashboardData = { ...dashboardData, items: [] };

function renderDashboard(loaderData = dashboardData) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createQueryClient()}>
        <Dashboard loaderData={loaderData} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Dashboard", () => {
  it("renders its primary heading", () => {
    renderDashboard();

    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
  });

  it("shows recent workspace cards and directory actions", () => {
    renderDashboard();
    expect(screen.getByRole("heading", { name: "Recently created" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Research library/ })).toHaveAttribute(
      "href",
      `/workspaces/${workspaceFixtures[0]!.id}`,
    );
    expect(screen.getByRole("link", { name: /View all/ })).toHaveAttribute("href", "/workspaces");
    expect(screen.getByRole("button", { name: /Create workspace/ })).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    renderDashboard(emptyDashboardData);
    expect(screen.getByText("No workspaces yet")).toBeInTheDocument();
  });
});
