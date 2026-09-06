import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type SubmitEvent } from "react";
import { Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import { Spinner } from "~/components/ui/spinner";
import { browserApiClient } from "~/lib/api.client";
import { refreshDocuments, uploadDocumentMutation, type UploadResponse } from "~/queries/documents";
import { sidebarWorkspacesQuery } from "~/queries/workspaces";
import {
  readFormText,
  DocumentError,
  MetadataFields,
  readAttachmentMetadata,
  readDocumentMetadata,
  WorkspaceSelect,
} from "./fields";

export function UploadDocumentSheet({
  onUploaded,
}: {
  onUploaded: (result: UploadResponse) => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const controller = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const workspaces = useQuery({ ...sidebarWorkspacesQuery(browserApiClient), enabled: open });
  const mutation = useMutation({
    ...uploadDocumentMutation(browserApiClient),
    onSettled: () => refreshDocuments(queryClient),
  });
  useEffect(() => () => controller.current?.abort(), []);

  const submit = useCallback(
    async (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (controller.current) return;
      setError(null);
      const form = new FormData(event.currentTarget);
      const file = fileInput.current?.files?.[0];
      if (!file || !file.size) {
        setError(new Error("Choose a non-empty PDF file."));
        return;
      }
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setError(new Error("Choose a PDF file."));
        return;
      }
      const abortController = new AbortController();
      controller.current = abortController;
      try {
        const result = await mutation.mutateAsync({
          workspaceId: readFormText(form, "workspaceId"),
          file,
          metadata: { ...readDocumentMetadata(form), ...readAttachmentMetadata(form) },
          signal: abortController.signal,
        });
        onUploaded(result);
        setOpen(false);
      } catch (failure) {
        setError(
          abortController.signal.aborted
            ? new Error(
                "Upload cancelled. Check your document library before retrying; the upload may have completed.",
              )
            : failure,
        );
      } finally {
        controller.current = null;
      }
    },
    [mutation, onUploaded],
  );
  const changeOpen = useCallback(
    (value: boolean) => {
      if (mutation.isPending) return;
      setOpen(value);
      setError(null);
    },
    [mutation.isPending],
  );
  const { refetch: refetchWorkspaces } = workspaces;
  const retryWorkspaces = useCallback(() => {
    void refetchWorkspaces();
  }, [refetchWorkspaces]);
  const cancel = useCallback(() => {
    if (mutation.isPending) controller.current?.abort();
    else setOpen(false);
  }, [mutation.isPending]);

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetTrigger asChild>
        <Button>
          <Upload aria-hidden="true" /> Upload PDF
        </Button>
      </SheetTrigger>
      <SheetContent
        className="w-full overflow-y-auto sm:max-w-lg"
        showCloseButton={!mutation.isPending}
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Upload a document</SheetTitle>
          <SheetDescription>
            Add a readable, unencrypted PDF to a workspace. Existing copies are reused
            automatically.
          </SheetDescription>
        </SheetHeader>
        {workspaces.isPending ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : workspaces.error ? (
          <div className="space-y-3 p-4">
            <DocumentError error={workspaces.error} />
            <Button variant="outline" onClick={retryWorkspaces}>
              Retry workspaces
            </Button>
          </div>
        ) : !workspaces.data?.items.length ? (
          <div className="space-y-4 p-4">
            <p>Create a workspace before uploading your first document.</p>
            <Button asChild>
              <Link to="/workspaces">Go to workspaces</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5 p-4">
            <fieldset disabled={mutation.isPending} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="upload-workspace">Workspace</Label>
                <WorkspaceSelect
                  id="upload-workspace"
                  name="workspaceId"
                  workspaces={workspaces.data.items}
                  required
                />
              </div>
              <div className="space-y-2 rounded-xl border border-dashed bg-muted/30 p-4">
                <Label htmlFor="upload-file">PDF file</Label>
                <Input
                  ref={fileInput}
                  id="upload-file"
                  name="file"
                  type="file"
                  accept="application/pdf,.pdf"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Your file is validated before it is added to the library.
                </p>
              </div>
              <MetadataFields prefix="upload" />
              <div className="space-y-2">
                <Label htmlFor="upload-tags">Workspace tags (optional)</Label>
                <Input id="upload-tags" name="tags" placeholder="research, reference" />
                <p className="text-xs text-muted-foreground">
                  Separate tags with commas. Up to 32 tags, 64 characters each.
                </p>
              </div>
            </fieldset>
            <DocumentError error={error} />
            {mutation.isPending ? (
              <output className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner /> Uploading and validating your PDF…
              </output>
            ) : null}
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={cancel}>
                {mutation.isPending ? "Cancel upload" : "Cancel"}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                Upload document
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
