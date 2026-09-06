import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState, type SubmitEvent } from "react";
import { Button } from "~/components/ui/button";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { Spinner } from "~/components/ui/spinner";
import { browserApiClient } from "~/lib/api.client";
import {
  deleteDocumentMutation,
  documentQuery,
  documentQueryKeys,
  refreshDocuments,
  updateDocumentMutation,
  type DocumentItem,
} from "~/queries/documents";
import {
  DocumentError,
  DocumentStatusBadge,
  formatDocumentSize,
  MetadataFields,
  readDocumentMetadata,
} from "./fields";
import { WorkspaceAttachment } from "./workspace-attachment";

export function ManageDocumentSheet({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose: () => void;
}) {
  const detail = useQuery(documentQuery(browserApiClient, documentId));
  const changeOpen = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  const { refetch: refetchDetail } = detail;
  const retry = useCallback(() => {
    void refetchDetail();
  }, [refetchDetail]);
  return (
    <Sheet open onOpenChange={changeOpen}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Manage document</SheetTitle>
          <SheetDescription>
            Edit library metadata and manage workspace attachments.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-6 p-4">
          {detail.isPending ? (
            <Spinner />
          ) : detail.error ? (
            <>
              <DocumentError error={detail.error} />
              <Button variant="outline" onClick={retry}>
                Retry document
              </Button>
            </>
          ) : (
            <DocumentDetails document={detail.data.item} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DocumentDetails({ document }: { document: DocumentItem }) {
  const queryClient = useQueryClient();
  const update = useMutation({
    ...updateDocumentMutation(browserApiClient),
    onSuccess: async ({ item }) => {
      queryClient.setQueryData(documentQueryKeys.detail(item.id), { item });
      await refreshDocuments(queryClient);
      toast.success("Document metadata saved.");
    },
  });
  const submit = useCallback(
    async (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        await update.mutateAsync({
          id: document.id,
          metadata: readDocumentMetadata(new FormData(event.currentTarget)),
        });
      } catch {
        /* Preserve edits and display the error. */
      }
    },
    [update, document.id],
  );
  const deleting = document.status === "deleting";
  return (
    <>
      <div className="space-y-3">
        <h2 className="break-words text-xl font-semibold">
          {document.title || document.originalFilename}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <DocumentStatusBadge status={document.status} />
          <span className="text-xs text-muted-foreground">
            {formatDocumentSize(document.originalSizeBytes)}
            {document.pageCount !== null ? ` · ${document.pageCount} pages` : ""}
          </span>
        </div>
        <p className="break-words text-xs text-muted-foreground">{document.originalFilename}</p>
      </div>
      {document.status === "uploaded" ? (
        <p className="text-sm text-muted-foreground">
          Your PDF has been uploaded. Processing has not started yet.
        </p>
      ) : null}
      {document.status === "failed" ? (
        <p className="text-sm text-destructive">
          Document processing failed. Automatic retry is not available here.
        </p>
      ) : null}
      {deleting ? (
        <output className="block rounded-lg bg-muted p-3 text-sm">
          Deletion requested. This document is awaiting removal.
        </output>
      ) : null}
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={deleting || update.isPending} className="space-y-4">
          <MetadataFields
            prefix="edit-document"
            title={document.title ?? ""}
            description={document.description ?? ""}
          />
          <Button type="submit">{update.isPending ? "Saving…" : "Save metadata"}</Button>
        </fieldset>
        <DocumentError error={update.error} />
      </form>
      <WorkspaceAttachment documentId={document.id} disabled={deleting} />
      <DeleteDocument document={document} />
    </>
  );
}

function DeleteDocument({ document }: { document: DocumentItem }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...deleteDocumentMutation(browserApiClient),
    onSuccess: async ({ item }) => {
      queryClient.setQueryData(documentQueryKeys.detail(item.id), { item });
      await refreshDocuments(queryClient);
      setOpen(false);
      toast.success("Document deletion requested.");
    },
  });
  const changeOpen = useCallback(
    (value: boolean) => {
      if (!mutation.isPending) {
        setOpen(value);
        mutation.reset();
      }
    },
    [mutation],
  );
  const requestDeletion = useCallback(() => mutation.mutate(document.id), [mutation, document.id]);
  return (
    <section className="space-y-3 border-t pt-5">
      <h3 className="font-semibold">Delete document</h3>
      <p className="text-sm text-muted-foreground">
        Detach this document from every workspace before requesting deletion.
      </p>
      <AlertDialog open={open} onOpenChange={changeOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" disabled={document.status === "deleting"}>
            Request deletion
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{document.title || document.originalFilename}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This requests removal of the document from your library. Once removed, it cannot be
              recovered here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <DocumentError error={mutation.error} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={mutation.isPending} onClick={requestDeletion}>
              {mutation.isPending ? "Requesting…" : "Confirm deletion"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
