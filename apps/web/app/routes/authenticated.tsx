import { authClient } from "@repo/auth/client";
import { useCallback, useState } from "react";
import { data, Outlet, redirect, useNavigate } from "react-router";

import type { Route } from "./+types/authenticated";
import { AppSidebar } from "~/components/app-sidebar";
import { Separator } from "~/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "~/components/ui/sidebar";
import { getServerSession } from "~/lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const { headers, session } = await getServerSession(request);

  if (!session) {
    throw redirect("/", { headers });
  }

  const sidebarDefaultOpen = !request.headers
    .get("cookie")
    ?.split(";")
    .some((cookie) => cookie.trim() === "sidebar_state=false");

  return data({ session, sidebarDefaultOpen }, { headers });
}

export default function AuthenticatedLayout({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setError(undefined);
    setIsSigningOut(true);

    try {
      const result = await authClient.signOut();

      if (result.error) {
        setError(result.error.message ?? "Unable to sign out.");
        return;
      }

      await navigate("/", { replace: true });
    } catch {
      setError("Unable to reach the authentication service.");
    } finally {
      setIsSigningOut(false);
    }
  }, [navigate]);

  return (
    <SidebarProvider defaultOpen={loaderData.sidebarDefaultOpen}>
      <AppSidebar
        user={loaderData.session.user}
        error={error}
        isSigningOut={isSigningOut}
        onSignOut={handleSignOut}
      />
      <SidebarInset>
        <header className="bg-background/85 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <p className="text-sm font-medium">Squee Online</p>
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
