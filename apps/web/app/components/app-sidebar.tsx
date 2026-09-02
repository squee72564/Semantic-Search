import { QueryErrorResetBoundary, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { ChevronRight, FolderKanban, LayoutDashboard, LogOut, Sparkles } from "lucide-react";
import { Component, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "~/components/ui/sidebar";
import { Spinner } from "~/components/ui/spinner";
import { browserApiClient } from "~/lib/api.client";
import { sidebarWorkspacesQuery } from "~/queries/workspaces";

const navigation = [{ title: "Dashboard", to: "/dashboard", icon: LayoutDashboard }];

interface AppSidebarProps {
  user: {
    email: string;
    name: string;
  };
  error: string | undefined;
  isSigningOut: boolean;
  onSignOut: () => void;
}

export function AppSidebar({ user, error, isSigningOut, onSignOut }: AppSidebarProps) {
  const location = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const [isClient, setIsClient] = useState(false);
  const [areWorkspacesOpen, setAreWorkspacesOpen] = useState(() =>
    location.pathname.startsWith("/workspaces/"),
  );

  useEffect(() => setIsClient(true), []);
  useEffect(() => {
    if (location.pathname.startsWith("/workspaces/")) {
      setAreWorkspacesOpen(true);
    }
  }, [location.pathname]);

  const closeMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="Squee Online">
              <NavLink to="/dashboard" onClick={closeMobileSidebar}>
                <span className="bg-sidebar-primary text-sidebar-primary-foreground grid size-8 shrink-0 place-items-center rounded-lg">
                  <Sparkles className="size-4" aria-hidden="true" />
                </span>
                <span className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">Squee Online</span>
                  <span className="text-sidebar-foreground/70 truncate text-xs">Workspace</span>
                </span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {navigation.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === item.to}
                    tooltip={item.title}
                  >
                    <NavLink to={item.to} onClick={closeMobileSidebar}>
                      <item.icon aria-hidden="true" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <Collapsible asChild open={areWorkspacesOpen} onOpenChange={setAreWorkspacesOpen}>
                <SidebarMenuItem className="group/collapsible">
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname.startsWith("/workspaces")}
                    tooltip="Workspaces"
                  >
                    <NavLink to="/workspaces" onClick={closeMobileSidebar}>
                      <FolderKanban aria-hidden="true" />
                      <span>Workspaces</span>
                    </NavLink>
                  </SidebarMenuButton>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuAction
                      aria-label={areWorkspacesOpen ? "Collapse workspaces" : "Expand workspaces"}
                    >
                      <ChevronRight
                        className="transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 motion-reduce:transition-none"
                        aria-hidden="true"
                      />
                    </SidebarMenuAction>
                  </CollapsibleTrigger>
                  {isClient ? <WorkspaceQueryPreloader /> : null}
                  <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
                    {isClient ? <WorkspaceSubmenuBoundary onNavigate={closeMobileSidebar} /> : null}
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {error ? (
          <p
            className="text-destructive px-2 text-xs group-data-[collapsible=icon]:hidden"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip={isSigningOut ? "Signing out…" : "Sign out"}
              onClick={onSignOut}
              disabled={isSigningOut}
            >
              <span className="bg-sidebar-accent grid size-8 shrink-0 place-items-center rounded-lg font-semibold uppercase">
                {user.name.charAt(0) || user.email.charAt(0)}
              </span>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="text-sidebar-foreground/70 truncate text-xs">{user.email}</span>
              </span>
              <LogOut className="ml-auto" aria-hidden="true" />
              <span className="sr-only">{isSigningOut ? "Signing out…" : "Sign out"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function WorkspaceQueryPreloader() {
  useQuery(sidebarWorkspacesQuery(browserApiClient));
  return null;
}

function WorkspaceSubmenuBoundary({ onNavigate }: { onNavigate: () => void }) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <WorkspaceNavigationErrorBoundary onReset={reset}>
          <Suspense fallback={workspaceSubmenuLoadingFallback}>
            <WorkspaceSubmenu onNavigate={onNavigate} />
          </Suspense>
        </WorkspaceNavigationErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}

function WorkspaceSubmenu({ onNavigate }: { onNavigate: () => void }) {
  const { data } = useSuspenseQuery(sidebarWorkspacesQuery(browserApiClient));
  const location = useLocation();

  return (
    <SidebarMenuSub className="max-h-64 overflow-y-auto">
      {data.items.length === 0 ? (
        <SidebarMenuSubItem>
          <p className="px-2 py-1 text-xs text-sidebar-foreground/70">No workspaces yet.</p>
        </SidebarMenuSubItem>
      ) : (
        data.items.map((workspace) => {
          const to = `/workspaces/${workspace.id}`;
          return (
            <SidebarMenuSubItem key={workspace.id}>
              <SidebarMenuSubButton asChild isActive={location.pathname === to}>
                <NavLink to={to} onClick={onNavigate}>
                  <span>{workspace.name}</span>
                </NavLink>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          );
        })
      )}
    </SidebarMenuSub>
  );
}

function WorkspaceSubmenuLoading() {
  return (
    <SidebarMenuSub>
      <SidebarMenuSubItem>
        <div className="flex h-7 items-center px-2 text-sidebar-foreground/70">
          <Spinner className="size-3.5" />
        </div>
      </SidebarMenuSubItem>
    </SidebarMenuSub>
  );
}

const workspaceSubmenuLoadingFallback = <WorkspaceSubmenuLoading />;

function WorkspaceSubmenuError({ onRetry }: { onRetry: () => void }) {
  return (
    <SidebarMenuSub>
      <SidebarMenuSubItem>
        <div className="space-y-1 px-2 py-1.5 text-xs text-destructive" role="alert">
          <p>Unable to load workspaces.</p>
          <button type="button" className="text-sidebar-foreground underline" onClick={onRetry}>
            Retry
          </button>
        </div>
      </SidebarMenuSubItem>
    </SidebarMenuSub>
  );
}

interface WorkspaceNavigationErrorBoundaryProps {
  children: ReactNode;
  onReset: () => void;
}

class WorkspaceNavigationErrorBoundary extends Component<
  WorkspaceNavigationErrorBoundaryProps,
  { hasError: boolean }
> {
  override state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  private readonly reset = () => {
    this.props.onReset();
    this.setState({ hasError: false });
  };

  override render() {
    return this.state.hasError ? (
      <WorkspaceSubmenuError onRetry={this.reset} />
    ) : (
      this.props.children
    );
  }
}
