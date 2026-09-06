import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileText, RefreshCw } from "lucide-react";
import { useCallback, useState, type SubmitEvent } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/documents";
import {
  DocumentError,
  DocumentSelect,
  DocumentStatusBadge,
  documentStatusLabels,
  formatDocumentSize,
  readFormText,
  WorkspaceSelect,
  type WorkspaceOption,
} from "~/components/documents/fields";
import { ManageDocumentSheet } from "~/components/documents/manage-sheet";
import { UploadDocumentSheet } from "~/components/documents/upload-sheet";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { browserApiClient } from "~/lib/api.client";
import { createServerApiClient } from "~/lib/api.server";
import { createQueryClient } from "~/query-client";
import {
  documentsQuery,
  type DocumentItem,
  type DocumentsQueryInput,
  type UploadResponse,
} from "~/queries/documents";
import { sidebarWorkspacesQuery } from "~/queries/workspaces";

const PAGE_SIZE = "20";
const initialQuery = { limit: PAGE_SIZE };
const noWorkspaces: WorkspaceOption[] = [];
export function meta() {
  return [{ title: "Documents | Squee Online" }];
}
export async function loader({ request }: Route.LoaderArgs) {
  return createQueryClient().fetchQuery(
    documentsQuery(createServerApiClient(request), initialQuery),
  );
}

export default function Documents({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
}) {
  const [filters, setFilters] = useState<DocumentsQueryInput>({});
  const [cursors, setCursors] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const cursor = cursors.at(-1);
  const filtered = Object.keys(filters).length > 0;
  const query = { ...filters, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) };
  const documents = useQuery({
    ...documentsQuery(browserApiClient, query),
    ...(!cursor && !filtered ? { initialData: loaderData } : {}),
  });
  const applyFilters = useCallback((next: DocumentsQueryInput) => {
    setFilters(next);
    setCursors([]);
  }, []);
  const closeDetails = useCallback(() => setSelectedId(null), []);
  const { refetch: refetchDocuments } = documents;
  const refresh = useCallback(() => {
    void refetchDocuments();
  }, [refetchDocuments]);
  const previousPage = useCallback(() => setCursors((value) => value.slice(0, -1)), []);
  const nextCursor = documents.data?.pageInfo.nextCursor;
  const nextPage = useCallback(() => {
    if (nextCursor) setCursors((value) => [...value, nextCursor]);
  }, [nextCursor]);
  const uploaded = useCallback((result: UploadResponse) => {
    toast.success(
      result.reused ? "Existing document reused in your library." : "PDF uploaded to your library.",
    );
    setSelectedId(result.document.id);
  }, []);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            <FileText className="size-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-primary">Your research library</p>
            <h1 className="text-4xl font-black tracking-tight">Documents</h1>
          </div>
        </div>
        <UploadDocumentSheet onUploaded={uploaded} />
      </div>
      <p className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
        Keep your PDFs in one library. Organize them across workspaces, update their details, and
        track their status.
      </p>
      <Card className="mt-8 gap-0 overflow-hidden py-0">
        <DocumentFilters
          onApply={applyFilters}
          onRefresh={refresh}
          refreshing={documents.isFetching}
        />
        <DocumentResults
          items={documents.data?.items}
          pending={documents.isPending}
          error={documents.error}
          filtered={filtered}
          onRetry={refresh}
          onManage={setSelectedId}
        />
        <div className="flex items-center justify-between border-t p-4">
          <Button
            variant="outline"
            size="sm"
            disabled={!cursor || documents.isFetching}
            onClick={previousPage}
          >
            <ChevronLeft aria-hidden="true" /> Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {cursors.length + 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!nextCursor || documents.isFetching || Boolean(documents.error)}
            onClick={nextPage}
          >
            Next <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </Card>
      {selectedId ? (
        <ManageDocumentSheet key={selectedId} documentId={selectedId} onClose={closeDetails} />
      ) : null}
    </div>
  );
}

function DocumentFilters({
  onApply,
  onRefresh,
  refreshing,
}: {
  onApply: (filters: DocumentsQueryInput) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const workspaces = useQuery(sidebarWorkspacesQuery(browserApiClient));
  const { refetch: refetchWorkspaces } = workspaces;
  const retryWorkspaces = useCallback(() => {
    void refetchWorkspaces();
  }, [refetchWorkspaces]);
  const apply = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const workspaceId = readFormText(form, "workspaceId");
      const status = readFormText(form, "status");
      const tag = readFormText(form, "tag").trim();
      const next: DocumentsQueryInput = {};
      if (workspaceId) next.workspaceId = workspaceId;
      if (tag) next.tag = tag;
      if (
        status === "uploaded" ||
        status === "processing" ||
        status === "ready" ||
        status === "failed" ||
        status === "deleting"
      )
        next.status = status;
      onApply(next);
    },
    [onApply],
  );
  const reset = useCallback(() => onApply({}), [onApply]);
  return (
    <>
      <form
        onSubmit={apply}
        onReset={reset}
        className="grid gap-4 border-b bg-muted/20 p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]"
      >
        <div className="space-y-2">
          <Label htmlFor="filter-workspace">Workspace</Label>
          <WorkspaceSelect
            id="filter-workspace"
            name="workspaceId"
            workspaces={workspaces.data?.items ?? noWorkspaces}
            placeholder="All workspaces"
            disabled={workspaces.isPending || Boolean(workspaces.error)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="filter-status">Status</Label>
          <DocumentSelect id="filter-status" name="status">
            <option value="">All statuses</option>
            {Object.entries(documentStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </DocumentSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="filter-tag">Workspace tag</Label>
          <Input id="filter-tag" name="tag" placeholder="e.g. research" maxLength={64} />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" variant="outline">
            Apply filters
          </Button>
          <Button type="reset" variant="ghost">
            Reset
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Refresh documents"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
          </Button>
        </div>
      </form>
      {workspaces.error ? (
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <DocumentError error={workspaces.error} />
          <Button size="sm" variant="outline" onClick={retryWorkspaces}>
            Retry workspaces
          </Button>
        </div>
      ) : null}
    </>
  );
}

function DocumentResults({
  items,
  pending,
  error,
  filtered,
  onRetry,
  onManage,
}: {
  items: DocumentItem[] | undefined;
  pending: boolean;
  error: unknown;
  filtered: boolean;
  onRetry: () => void;
  onManage: (id: string) => void;
}) {
  if (pending)
    return (
      <div className="space-y-4 p-6" aria-label="Loading documents">
        {[0, 1, 2].map((id) => (
          <Skeleton key={id} className="h-16 w-full" />
        ))}
      </div>
    );
  if (error)
    return (
      <div className="space-y-3 p-6">
        <DocumentError error={error} />
        <Button variant="outline" onClick={onRetry}>
          Retry documents
        </Button>
      </div>
    );
  if (!items?.length)
    return (
      <div className="px-6 py-16 text-center">
        <FileText className="mx-auto mb-4 size-10 text-muted-foreground/60" aria-hidden="true" />
        <h2 className="text-lg font-semibold">
          {filtered ? "No matching documents" : "Your library starts here"}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {filtered
            ? "Try another workspace, status, or tag."
            : "Upload a PDF to add it to your document library."}
        </p>
      </div>
    );
  return (
    <ul className="divide-y">
      {items.map((document) => (
        <DocumentRow key={document.id} document={document} onManage={onManage} />
      ))}
    </ul>
  );
}

function DocumentRow({
  document,
  onManage,
}: {
  document: DocumentItem;
  onManage: (id: string) => void;
}) {
  const manage = useCallback(() => onManage(document.id), [document.id, onManage]);
  return (
    <li className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="rounded-lg bg-muted p-2.5">
          <FileText className="size-5 text-muted-foreground" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="break-words font-semibold">
            {document.title || document.originalFilename}
          </h2>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {document.originalFilename} · {formatDocumentSize(document.originalSizeBytes)}
          </p>
          {document.description ? (
            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
              {document.description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <DocumentStatusBadge status={document.status} />
        <Button
          variant="outline"
          size="sm"
          aria-label={`Manage ${document.title || document.originalFilename}`}
          onClick={manage}
        >
          Manage
        </Button>
      </div>
    </li>
  );
}

export function ErrorBoundary() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <Card className="p-6">
        <h1 className="text-lg font-semibold">Unable to load documents</h1>
        <p className="text-sm text-muted-foreground">
          The document service could not be reached. Please try again.
        </p>
        <Button asChild variant="outline">
          <Link to="/documents" reloadDocument>
            Retry documents
          </Link>
        </Button>
      </Card>
    </div>
  );
}
