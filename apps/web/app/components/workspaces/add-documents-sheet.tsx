import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { DocumentError, formatDocumentSize } from "~/components/documents/fields";
import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import { browserApiClient } from "~/lib/api.client";
import {
  attachDocumentMutation,
  documentQueryKeys,
  documentsQuery,
  refreshDocuments,
  workspaceDocumentMembershipQuery,
  type DocumentItem,
  type DocumentsQueryInput,
} from "~/queries/documents";
import { DocumentPagination, DocumentSearchFilters } from "./document-list-controls";

type DocumentSearchInput = Pick<DocumentsQueryInput, "search">;

export function AddDocumentsSheet({
  workspaceId,
  onClose,
  onCloseAutoFocus,
}: {
  workspaceId: string;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [filters, setFilters] = useState<DocumentSearchInput>({});
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const documents = useQuery(
    documentsQuery(browserApiClient, {
      ...filters,
      status: "ready",
      limit: "20",
      ...(cursor ? { cursor } : {}),
    }),
  );
  const membership = useQuery(workspaceDocumentMembershipQuery(browserApiClient, workspaceId));
  const apply = useCallback((value: DocumentSearchInput) => {
    setFilters(value);
    setCursors([]);
  }, []);
  const { refetch: refetchDocuments } = documents;
  const { refetch: refetchMembership } = membership;
  const refresh = useCallback(() => {
    void refetchDocuments();
    void refetchMembership();
  }, [refetchDocuments, refetchMembership]);
  const retryMembership = useCallback(() => {
    void refetchMembership();
  }, [refetchMembership]);
  const previous = useCallback(() => setCursors((value) => value.slice(0, -1)), []);
  const nextCursor = documents.data?.pageInfo.nextCursor;
  const next = useCallback(() => {
    if (nextCursor) setCursors((value) => [...value, nextCursor]);
  }, [nextCursor]);
  const changeOpen = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  return (
    <Sheet open onOpenChange={changeOpen}>
      <SheetContent
        onCloseAutoFocus={onCloseAutoFocus}
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Add documents</SheetTitle>
          <SheetDescription>
            Only documents that have finished processing are available.
          </SheetDescription>
          <Link to="/documents" className="mt-2 w-fit text-sm underline underline-offset-4">
            Open library
          </Link>
        </SheetHeader>
        <div className="px-4 pb-4">
          <div className="overflow-hidden rounded-xl border">
            <DocumentSearchFilters
              prefix="library"
              refreshing={documents.isFetching || membership.isFetching}
              onApply={apply}
              onRefresh={refresh}
            />
            {membership.isPending ? (
              <output className="block p-4 text-sm text-muted-foreground">
                Checking attachments…
              </output>
            ) : null}
            {membership.error ? (
              <div className="space-y-2 p-4">
                <DocumentError error={membership.error} />
                <Button variant="outline" onClick={retryMembership}>
                  Retry attachments
                </Button>
              </div>
            ) : null}
            {documents.error ? (
              <div className="space-y-2 p-4">
                <DocumentError error={documents.error} />
                <Button variant="outline" onClick={refresh}>
                  Retry documents
                </Button>
              </div>
            ) : null}
            {documents.isPending ? (
              <div className="space-y-3 p-4" aria-label="Loading library documents">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
            ) : documents.data ? (
              documents.data.items.length ? (
                <ul className="divide-y">
                  {documents.data.items.map((document) => (
                    <LibraryRow
                      key={document.id}
                      document={document}
                      workspaceId={workspaceId}
                      attached={membership.data?.includes(document.id) ?? false}
                      checking={membership.isPending || Boolean(membership.error)}
                    />
                  ))}
                </ul>
              ) : (
                <div className="px-4 py-12 text-center">
                  <h3 className="font-semibold">
                    {filters.search ? "No matching ready documents" : "No ready documents"}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {filters.search
                      ? "Try another title or filename, or reset the search."
                      : "Upload documents in your library, then return when processing is complete."}
                  </p>
                </div>
              )
            ) : null}
            <DocumentPagination
              page={cursors.length + 1}
              hasNext={Boolean(nextCursor)}
              busy={documents.isFetching || Boolean(documents.error)}
              onPrevious={previous}
              onNext={next}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LibraryRow({
  document,
  workspaceId,
  attached,
  checking,
}: {
  document: DocumentItem;
  workspaceId: string;
  attached: boolean;
  checking: boolean;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...attachDocumentMutation(browserApiClient),
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: documentQueryKeys.membership(workspaceId) });
      queryClient.setQueryData<string[]>(documentQueryKeys.membership(workspaceId), (ids) => [
        ...new Set([...(ids ?? []), document.id]),
      ]);
      await refreshDocuments(queryClient);
      toast.success("Document attached to workspace.");
    },
  });
  const add = useCallback(
    () => mutation.mutate({ workspaceId, documentId: document.id, attachment: {} }),
    [mutation, workspaceId, document.id],
  );
  const title = document.title || document.originalFilename;
  return (
    <li className="space-y-2 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <FileText className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="break-words font-medium">{title}</h3>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {document.originalFilename} · {formatDocumentSize(document.originalSizeBytes)}
            </p>
          </div>
        </div>
        <Button
          variant={attached ? "ghost" : "outline"}
          size="sm"
          className="shrink-0"
          disabled={checking || attached || mutation.isPending || document.status !== "ready"}
          onClick={add}
          aria-label={attached ? `${title} already attached` : `Add ${title}`}
        >
          {mutation.isPending ? (
            "Adding…"
          ) : attached ? (
            "Already attached"
          ) : (
            <>
              <Plus aria-hidden="true" /> Add
            </>
          )}
        </Button>
      </div>
      <DocumentError error={mutation.error} />
    </li>
  );
}
