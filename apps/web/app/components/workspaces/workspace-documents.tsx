import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import { useCallback, useRef, useState, type MouseEvent } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import {
  DocumentError,
  DocumentStatusBadge,
  formatDocumentSize,
} from "~/components/documents/fields";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { browserApiClient } from "~/lib/api.client";
import {
  detachDocumentMutation,
  documentQueryKeys,
  refreshDocuments,
  workspaceDocumentsQuery,
  type WorkspaceDocumentItem,
  type WorkspaceDocumentsQueryInput,
} from "~/queries/documents";
import { AddDocumentsSheet } from "./add-documents-sheet";
import { DocumentListFilters, DocumentPagination } from "./document-list-controls";
import { WorkspaceDocumentSheet } from "./workspace-document-sheet";

export function WorkspaceDocuments({
  workspaceId,
  active,
}: {
  workspaceId: string;
  active: boolean;
}) {
  const addButton = useRef<HTMLButtonElement>(null);
  const sheetTrigger = useRef<HTMLButtonElement | null>(null);
  const [filters, setFilters] = useState<WorkspaceDocumentsQueryInput>({});
  const [cursors, setCursors] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<WorkspaceDocumentItem | null>(null);
  const cursor = cursors.at(-1);
  const documents = useQuery({
    ...workspaceDocumentsQuery(browserApiClient, workspaceId, {
      ...filters,
      limit: "20",
      ...(cursor ? { cursor } : {}),
    }),
    enabled: active,
  });
  const apply = useCallback((value: WorkspaceDocumentsQueryInput) => {
    setFilters(value);
    setCursors([]);
  }, []);
  const resetPage = useCallback(() => setCursors([]), []);
  const { refetch } = documents;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const previous = useCallback(() => setCursors((value) => value.slice(0, -1)), []);
  const nextCursor = documents.data?.pageInfo.nextCursor;
  const next = useCallback(() => {
    if (nextCursor) setCursors((value) => [...value, nextCursor]);
  }, [nextCursor]);
  const openAdd = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    sheetTrigger.current = event.currentTarget;
    setAdding(true);
  }, []);
  const openEdit = useCallback((item: WorkspaceDocumentItem, trigger: HTMLButtonElement) => {
    sheetTrigger.current = trigger;
    setSelected(item);
  }, []);
  const restoreFocus = useCallback((event: Event) => {
    event.preventDefault();
    const target = sheetTrigger.current;
    if (target?.isConnected) target.focus();
    else addButton.current?.focus();
  }, []);
  const closeAdd = useCallback(() => setAdding(false), []);
  const closeEdit = useCallback(() => setSelected(null), []);
  const filtered = Boolean(filters.status || filters.tag);
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Documents</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The sources referenced in this workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link to="/documents">Open library</Link>
          </Button>
          <Button ref={addButton} onClick={openAdd}>
            <Plus aria-hidden="true" /> Add documents
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border">
        <DocumentListFilters
          prefix="workspace"
          refreshing={documents.isFetching}
          onApply={apply}
          onRefresh={refresh}
        />
        {documents.error ? (
          <div className="space-y-2 p-4">
            <DocumentError error={documents.error} />
            <Button variant="outline" onClick={refresh}>
              Retry documents
            </Button>
          </div>
        ) : null}
        {documents.isPending ? (
          <div aria-label="Loading workspace documents" className="space-y-4 p-5">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : documents.data ? (
          documents.data.items.length ? (
            <ul className="divide-y">
              {documents.data.items.map((item) => (
                <WorkspaceDocumentRow
                  key={item.document.id}
                  item={item}
                  onEdit={openEdit}
                  onDetached={resetPage}
                />
              ))}
            </ul>
          ) : (
            <div className="px-6 py-14 text-center">
              <FileText
                className="mx-auto mb-4 size-10 text-muted-foreground/60"
                aria-hidden="true"
              />
              <h3 className="font-semibold">
                {filtered ? "No matching documents" : "Add your first document"}
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                {filtered
                  ? "Try another status or tag, or reset the filters."
                  : "Bring processed documents from your library into this workspace to keep your research together."}
              </p>
              {!filtered ? (
                <Button variant="outline" className="mt-5" onClick={openAdd}>
                  <Plus aria-hidden="true" /> Browse library
                </Button>
              ) : null}
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
      {adding && active ? (
        <AddDocumentsSheet
          workspaceId={workspaceId}
          onClose={closeAdd}
          onCloseAutoFocus={restoreFocus}
        />
      ) : null}
      {selected && active ? (
        <WorkspaceDocumentSheet
          key={selected.document.id}
          item={selected}
          onClose={closeEdit}
          onSaved={resetPage}
          onCloseAutoFocus={restoreFocus}
        />
      ) : null}
    </section>
  );
}

function WorkspaceDocumentRow({
  item,
  onEdit,
  onDetached,
}: {
  item: WorkspaceDocumentItem;
  onEdit: (item: WorkspaceDocumentItem, trigger: HTMLButtonElement) => void;
  onDetached: () => void;
}) {
  const queryClient = useQueryClient();
  const { document, attachment } = item;
  const mutation = useMutation({
    ...detachDocumentMutation(browserApiClient),
    onSuccess: async () => {
      await queryClient.cancelQueries({
        queryKey: documentQueryKeys.membership(attachment.workspaceId),
      });
      queryClient.setQueryData<string[]>(
        documentQueryKeys.membership(attachment.workspaceId),
        (ids) => ids?.filter((id) => id !== document.id),
      );
      onDetached();
      await refreshDocuments(queryClient);
      toast.success("Document detached. It remains in your library.");
    },
  });
  const remove = useCallback(
    () => mutation.mutate({ workspaceId: attachment.workspaceId, documentId: document.id }),
    [mutation, attachment.workspaceId, document.id],
  );
  const edit = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => onEdit(item, event.currentTarget),
    [onEdit, item],
  );
  const title = attachment.displayTitle || document.title || document.originalFilename;
  return (
    <li className="space-y-3 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="rounded-lg bg-muted p-2.5">
            <FileText className="size-5 text-muted-foreground" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="break-words font-semibold">{title}</h3>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {document.originalFilename} · {formatDocumentSize(document.originalSizeBytes)}
            </p>
            {attachment.tags.length ? (
              <ul aria-label="Workspace tags" className="mt-2 flex flex-wrap gap-1.5">
                {attachment.tags.map((tag) => (
                  <li
                    key={tag}
                    className="max-w-full break-words rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {tag}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <DocumentStatusBadge status={document.status} />
          <Button
            size="sm"
            variant="outline"
            onClick={edit}
            disabled={mutation.isPending}
            aria-label={`Edit workspace details for ${title}`}
          >
            Edit workspace details
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={remove}
            disabled={mutation.isPending}
            aria-label={`Detach ${title}`}
          >
            {mutation.isPending ? "Detaching…" : "Detach"}
          </Button>
        </div>
      </div>
      <DocumentError error={mutation.error} />
    </li>
  );
}
