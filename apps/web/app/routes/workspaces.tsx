import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FolderKanban } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type { Route } from "./+types/workspaces";
import { WorkspaceCard, type WorkspaceCardItem } from "~/components/workspace-card";
import { CreateWorkspaceSheet } from "~/components/workspace-sheet";
import { Button } from "~/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { browserApiClient } from "~/lib/api.client";
import { createServerApiClient } from "~/lib/api.server";
import { createQueryClient } from "~/query-client";
import { workspacesQuery, type WorkspacesQueryInput } from "~/queries/workspaces";

const WORKSPACE_LIMIT = 20;
type WorkspacePage = Awaited<ReturnType<typeof loader>>;

const emptyWorkspacePage: WorkspacePage = {
  items: [],
  limit: WORKSPACE_LIMIT,
  pageInfo: { hasMore: false, nextCursor: null },
};

export function meta() {
  return [{ title: "Workspaces | Squee Online" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  return createQueryClient().fetchQuery(
    workspacesQuery(createServerApiClient(request), { limit: String(WORKSPACE_LIMIT) }),
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load workspaces. Please try again.";
}

export default function Workspaces({ loaderData }: { loaderData: WorkspacePage }) {
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const listInput = useMemo<WorkspacesQueryInput>(
    () => ({ ...(cursor ? { cursor } : {}), limit: String(WORKSPACE_LIMIT) }),
    [cursor],
  );
  const isFirstPage = cursors.length === 0;
  const workspaces = useQuery({
    ...workspacesQuery(browserApiClient, listInput),
    initialData: isFirstPage ? loaderData : emptyWorkspacePage,
    initialDataUpdatedAt: isFirstPage ? Date.now() : 0,
  });
  const previousPage = useCallback(() => setCursors((value) => value.slice(0, -1)), []);
  const nextPage = useCallback(() => {
    const nextCursor = workspaces.data.pageInfo.nextCursor;
    if (nextCursor) setCursors((value) => [...value, nextCursor]);
  }, [workspaces.data.pageInfo.nextCursor]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <FolderKanban className="size-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-primary">Organize your research</p>
            <h1 className="text-4xl font-black tracking-tight">Workspaces</h1>
          </div>
        </div>
        <CreateWorkspaceSheet />
      </div>

      <div className="mt-8">
        {workspaces.error ? (
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle>Unable to load workspaces</CardTitle>
              <CardDescription className="text-destructive" role="alert">
                {errorMessage(workspaces.error)}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : workspaces.isFetching && !isFirstPage && workspaces.data.items.length === 0 ? (
          <WorkspaceGridSkeleton />
        ) : (
          <div
            className={
              workspaces.isFetching ? "opacity-60 transition-opacity" : "transition-opacity"
            }
          >
            <WorkspaceGrid items={workspaces.data.items} />
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between border-t pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isFirstPage || workspaces.isFetching}
          onClick={previousPage}
        >
          <ChevronLeft aria-hidden="true" /> Previous
        </Button>
        <span className="text-xs text-muted-foreground">Page {cursors.length + 1}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            !workspaces.data.pageInfo.hasMore ||
            !workspaces.data.pageInfo.nextCursor ||
            workspaces.isFetching
          }
          onClick={nextPage}
        >
          Next <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function WorkspaceGridSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading workspaces">
      {[0, 1, 2].map((item) => (
        <Card key={item} className="h-56">
          <CardHeader>
            <Skeleton className="size-9 rounded-lg" />
            <Skeleton className="mt-2 h-5 w-2/3" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

export function WorkspaceGrid({ items }: { items: WorkspaceCardItem[] }) {
  if (items.length === 0) {
    return (
      <Card className="border-dashed bg-card/60">
        <div className="grid min-h-72 place-items-center px-6 text-center">
          <div>
            <FolderKanban
              className="mx-auto mb-4 size-10 text-muted-foreground/60"
              aria-hidden="true"
            />
            <h2 className="text-lg font-semibold">Create your first workspace</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Workspaces keep related documents and research together.
            </p>
            <div className="mt-5">
              <CreateWorkspaceSheet />
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((workspace) => (
        <WorkspaceCard key={workspace.id} workspace={workspace} />
      ))}
    </div>
  );
}

export function ErrorBoundary() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12 lg:px-8 lg:py-16">
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle>Unable to load workspaces</CardTitle>
          <CardDescription>
            The workspace service could not be reached. Please try again later.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
