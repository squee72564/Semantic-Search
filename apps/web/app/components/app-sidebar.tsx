import { FolderKanban, LayoutDashboard, LogOut, Sparkles } from "lucide-react";
import { useCallback } from "react";
import { NavLink, useLocation } from "react-router";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "~/components/ui/sidebar";

const navigation = [
  { title: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { title: "Workspaces", to: "/workspaces", icon: FolderKanban },
];

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
                    isActive={
                      location.pathname === item.to ||
                      (item.to === "/workspaces" && location.pathname.startsWith("/workspaces/"))
                    }
                    tooltip={item.title}
                  >
                    <NavLink to={item.to} onClick={closeMobileSidebar}>
                      <item.icon aria-hidden="true" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
