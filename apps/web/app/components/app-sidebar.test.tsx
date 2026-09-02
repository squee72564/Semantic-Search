import { QueryClientProvider } from "@tanstack/react-query";
import { workspaceFixtures } from "@repo/test-utils";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { AppSidebar } from "~/components/app-sidebar";
import { SidebarProvider } from "~/components/ui/sidebar";
import { TooltipProvider } from "~/components/ui/tooltip";
import { createQueryClient } from "~/query-client";
import { mockApi } from "~/test-setup";

const testUser = { email: "alex@example.com", name: "Alex" };

function memoryEntries(pathname: string) {
  return [pathname];
}

function renderSidebar(pathname = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={memoryEntries(pathname)}>
      <QueryClientProvider client={createQueryClient()}>
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar
              user={testUser}
              error={undefined}
              isSigningOut={false}
              onSignOut={vi.fn<() => void>()}
            />
          </SidebarProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("AppSidebar", () => {
  it("keeps directory navigation separate from the expandable workspace submenu", async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute("href", "/workspaces");
    const trigger = screen.getByRole("button", { name: "Expand workspaces" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    expect(screen.getByRole("button", { name: "Collapse workspaces" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(await screen.findByRole("link", { name: workspaceFixtures[0]!.name })).toHaveAttribute(
      "href",
      `/workspaces/${workspaceFixtures[0]!.id}`,
    );

    const content = document.querySelector('[data-slot="collapsible-content"]');
    expect(content).toHaveClass("data-[state=open]:animate-collapsible-down");
    expect(content).toHaveClass("data-[state=closed]:animate-collapsible-up");
    expect(content?.querySelector('[data-sidebar="menu-sub"]')).toHaveClass(
      "max-h-64",
      "overflow-y-auto",
    );
  });

  it("starts expanded and marks the exact workspace active on a detail route", async () => {
    const workspace = workspaceFixtures[0]!;
    renderSidebar(`/workspaces/${workspace.id}`);

    expect(screen.getByRole("button", { name: "Collapse workspaces" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(await screen.findByRole("link", { name: workspace.name })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByRole("link", { name: workspaceFixtures[1]!.name })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("shows a compact spinner if the submenu opens while the preload is pending", async () => {
    let finishRequest: (() => void) | undefined;
    const pendingRequest = new Promise<void>((resolve) => {
      finishRequest = resolve;
    });
    mockApi.use(
      http.get("*/workspaces", async () => {
        await pendingRequest;
        return HttpResponse.json({
          items: workspaceFixtures,
          limit: 100,
          pageInfo: { nextCursor: null },
        });
      }),
    );
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Expand workspaces" }));
    expect(await screen.findByRole("status", { name: "Loading" })).toBeInTheDocument();

    finishRequest?.();
    await waitFor(() => {
      expect(screen.getByRole("link", { name: workspaceFixtures[0]!.name })).toBeInTheDocument();
    });
  });

  it("renders the empty workspace state", async () => {
    mockApi.use(
      http.get("*/workspaces", () =>
        HttpResponse.json({ items: [], limit: 100, pageInfo: { nextCursor: null } }),
      ),
    );
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Expand workspaces" }));

    expect(await screen.findByText("No workspaces yet.")).toBeInTheDocument();
  });
});
