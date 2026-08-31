import { ArrowRight, FolderKanban, LayoutDashboard } from "lucide-react";
import { Link } from "react-router";

import type { Route } from "./+types/dashboard";
import { WorkspaceCard } from "~/components/workspace-card";
import { CreateWorkspaceSheet } from "~/components/workspace-sheet";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "~/components/ui/card";
import { createServerApiClient } from "~/lib/api.server";
import { createQueryClient } from "~/query-client";
import { workspacesQuery } from "~/queries/workspaces";

export function meta() {
  return [{ title: "Dashboard | Squee Online" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  return createQueryClient().fetchQuery(
    workspacesQuery(createServerApiClient(request), { limit: "4" }),
  );
}

export default function Dashboard({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12 lg:px-8 lg:py-16">
      <div className="flex items-center gap-4">
        <span className="bg-primary/10 text-primary grid size-12 place-items-center rounded-xl">
          <LayoutDashboard className="size-6" aria-hidden="true" />
        </span>
        <div>
          <p className="text-primary text-sm font-semibold">Private workspace</p>
          <h1 className="text-4xl font-black tracking-tight">Dashboard</h1>
        </div>
      </div>

      <section className="mt-10" aria-labelledby="recent-workspaces">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="recent-workspaces" className="text-2xl font-bold tracking-tight">
              Recently created
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your newest workspaces, ordered by creation date.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/workspaces">
                View all <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <CreateWorkspaceSheet />
          </div>
        </div>

        {loaderData.items.length > 0 ? (
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {loaderData.items.map((workspace) => (
              <WorkspaceCard key={workspace.id} workspace={workspace} />
            ))}
          </div>
        ) : (
          <Card className="mt-6 border-dashed bg-card/60">
            <CardContent className="grid min-h-52 place-items-center text-center">
              <div>
                <FolderKanban
                  className="mx-auto mb-3 size-9 text-muted-foreground/60"
                  aria-hidden="true"
                />
                <CardTitle>No workspaces yet</CardTitle>
                <CardDescription className="mt-2">
                  Create one to start organizing your research.
                </CardDescription>
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
