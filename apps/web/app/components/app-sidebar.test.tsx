import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import { AppSidebar } from "~/components/app-sidebar";
import { SidebarProvider } from "~/components/ui/sidebar";
import { TooltipProvider } from "~/components/ui/tooltip";

const sidebarUser = { email: "person@example.com", name: "Person" };
const noop = () => undefined;
const workspaceEntries = ["/workspaces"];
const workspaceDetailEntries = ["/workspaces/0198b3f4-6fb4-7000-8000-000000000101"];

function renderSidebar(initialEntries: string[]) {
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar user={sidebarUser} error={undefined} isSigningOut={false} onSignOut={noop} />
        </SidebarProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("AppSidebar workspace navigation", () => {
  it.each([
    ["/workspaces", workspaceEntries],
    ["/workspaces/0198b3f4-6fb4-7000-8000-000000000101", workspaceDetailEntries],
  ])("marks Workspaces active at %s", (_pathname, initialEntries) => {
    renderSidebar(initialEntries);
    expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute("data-active", "true");
  });
});
