import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, FolderKanban, Pencil, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { data, isRouteErrorResponse, Link, useNavigate } from "react-router";

import type { Route } from "./+types/workspace-detail";
import { EditWorkspaceSheet } from "~/components/workspace-sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { browserApiClient } from "~/lib/api.client";
import { createServerApiClient } from "~/lib/api.server";
import { createQueryClient } from "~/query-client";
import {
  deleteWorkspaceMutation,
  WorkspaceApiError,
  workspaceQuery,
  workspaceQueryKeys,
} from "~/queries/workspaces";

export function meta() {
  return [{ title: "Workspace | Squee Online" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  try {
    return await createQueryClient().fetchQuery(
      workspaceQuery(createServerApiClient(request), params.workspaceId),
    );
  } catch (error) {
    if (error instanceof WorkspaceApiError && error.status === 404) {
      throw data(null, { status: 404, statusText: "Not Found" });
    }
    throw error;
  }
}

export default function WorkspaceDetail({
  loaderData,
  params,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  params: { workspaceId: string };
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const detail = useQuery({
    ...workspaceQuery(browserApiClient, params.workspaceId),
    initialData: loaderData,
  });
  const workspace = detail.data.item;
  const deleteMutation = useMutation({
    ...deleteWorkspaceMutation(browserApiClient),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: workspaceQueryKeys.detail(workspace.id), exact: true });
      await queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.lists() });
      await navigate("/workspaces", { replace: true });
    },
  });
  const handleDelete = useCallback(async () => {
    try {
      await deleteMutation.mutateAsync(workspace.id);
    } catch {
      // The error remains visible on the detail page.
    }
  }, [deleteMutation, workspace.id]);
  const handleEdit = useCallback(() => setIsEditing(true), []);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <Link
        to="/workspaces"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Workspaces
      </Link>

      <div className="mt-7 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <FolderKanban className="size-6" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary">Workspace</p>
            <h1 className="break-words text-4xl font-black tracking-tight">{workspace.name}</h1>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" onClick={handleEdit}>
            <Pencil aria-hidden="true" /> Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive">
                <Trash2 aria-hidden="true" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{workspace.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the workspace organization. Future canonical documents remain
                  available independently. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={deleteMutation.isPending}
                  onClick={handleDelete}
                >
                  {deleteMutation.isPending ? "Deleting…" : "Delete workspace"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {deleteMutation.error ? (
        <p className="mt-5 text-sm text-destructive" role="alert">
          {deleteMutation.error instanceof Error
            ? deleteMutation.error.message
            : "Unable to delete workspace."}
        </p>
      ) : null}

      <Card className="mt-9">
        <CardHeader className="border-b">
          <CardTitle>About this workspace</CardTitle>
          <CardDescription>Workspace metadata and context.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h2 className="text-sm font-medium">Description</h2>
            <p className="mt-2 whitespace-pre-wrap leading-7 text-muted-foreground">
              {workspace.description || "No description yet."}
            </p>
          </div>
          <div className="flex items-center gap-2 border-t pt-5 text-sm text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden="true" />
            <span>
              Created{" "}
              <time dateTime={workspace.createdAt}>
                {new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(
                  new Date(workspace.createdAt),
                )}
              </time>
            </span>
          </div>
        </CardContent>
      </Card>

      <EditWorkspaceSheet workspace={workspace} open={isEditing} onOpenChange={setIsEditing} />
    </div>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const notFound =
    (error instanceof WorkspaceApiError && error.status === 404) ||
    (isRouteErrorResponse(error) && error.status === 404);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
      <Card className={notFound ? "border-dashed" : "border-destructive/30"}>
        <CardHeader>
          <h1 className="text-lg font-semibold">
            {notFound ? "Workspace not found" : "Unable to load workspace"}
          </h1>
          <CardDescription>
            {notFound
              ? "This workspace does not exist or you do not have access to it."
              : "The workspace service could not be reached. Please try again later."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/workspaces">
              <ArrowLeft aria-hidden="true" /> Back to Workspaces
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
