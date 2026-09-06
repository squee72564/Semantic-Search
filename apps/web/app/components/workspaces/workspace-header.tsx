import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, Pencil, Trash2 } from "lucide-react";
import { useCallback, useId, useRef, useState, type ComponentProps } from "react";
import { Link, useNavigate } from "react-router";
import { EditWorkspaceSheet } from "~/components/workspace-sheet";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { DocumentError } from "~/components/documents/fields";
import { browserApiClient } from "~/lib/api.client";
import { cn } from "~/lib/utils";
import { documentQueryKeys, refreshDocuments } from "~/queries/documents";
import { deleteWorkspaceMutation, workspaceQueryKeys } from "~/queries/workspaces";

type Workspace = ComponentProps<typeof EditWorkspaceSheet>["workspace"] & { createdAt: string };
export function WorkspaceHeader({ workspace }: { workspace: Workspace }) {
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreEditFocus = useCallback((event: Event) => {
    event.preventDefault();
    editButton.current?.focus();
  }, []);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const descriptionId = useId();
  const mutation = useMutation({
    ...deleteWorkspaceMutation(browserApiClient),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: workspaceQueryKeys.detail(workspace.id), exact: true });
      queryClient.removeQueries({ queryKey: documentQueryKeys.workspace(workspace.id) });
      queryClient.removeQueries({ queryKey: ["documents", "attachment", workspace.id] });
      await Promise.all([
        refreshDocuments(queryClient),
        queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.lists() }),
      ]);
      await navigate("/workspaces", { replace: true });
    },
  });
  const changeDeleting = useCallback(
    (open: boolean) => {
      if (!mutation.isPending) {
        setDeleting(open);
        mutation.reset();
      }
    },
    [mutation],
  );
  const remove = useCallback(() => mutation.mutate(workspace.id), [mutation, workspace.id]);
  const edit = useCallback(() => setEditing(true), []);
  const toggleDescription = useCallback(() => setExpanded((value) => !value), []);
  return (
    <header className="mb-6">
      <Link
        to="/workspaces"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Workspaces
      </Link>
      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-primary">Workspace</p>
          <h1 className="break-words text-3xl font-bold tracking-tight">{workspace.name}</h1>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button ref={editButton} variant="outline" onClick={edit}>
            <Pencil aria-hidden="true" /> Edit
          </Button>
          <AlertDialog open={deleting} onOpenChange={changeDeleting}>
            <AlertDialogTrigger asChild>
              <Button variant="ghost">
                <Trash2 aria-hidden="true" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{workspace.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This deletes the workspace and its document attachments. Documents remain in your
                  library. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <DocumentError error={mutation.error} />
              <AlertDialogFooter>
                <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
                <Button variant="destructive" disabled={mutation.isPending} onClick={remove}>
                  {mutation.isPending ? "Deleting…" : "Delete workspace"}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <div className="mt-3 max-w-3xl">
        <p
          id={descriptionId}
          className={cn(
            "whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground",
            !expanded && "line-clamp-2",
          )}
        >
          {workspace.description || "No description yet."}
        </p>
        {workspace.description ? (
          <button
            type="button"
            onClick={toggleDescription}
            aria-expanded={expanded}
            aria-controls={descriptionId}
            className="mt-1 rounded text-xs font-medium text-muted-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded ? "Show less" : "Show description"}
          </button>
        ) : null}
      </div>
      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarDays className="size-3.5" aria-hidden="true" /> Created{" "}
        <time dateTime={workspace.createdAt}>
          {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(
            new Date(workspace.createdAt),
          )}
        </time>
      </p>
      <EditWorkspaceSheet
        workspace={workspace}
        open={editing}
        onOpenChange={setEditing}
        onCloseAutoFocus={restoreEditFocus}
      />
    </header>
  );
}
