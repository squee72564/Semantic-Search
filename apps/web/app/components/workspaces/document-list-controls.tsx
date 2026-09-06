import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, type SubmitEvent } from "react";
import { DocumentSelect, documentStatusLabels, readFormText } from "~/components/documents/fields";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { DocumentsQueryInput, WorkspaceDocumentsQueryInput } from "~/queries/documents";

export function DocumentListFilters({
  prefix,
  refreshing,
  onApply,
  onRefresh,
}: {
  prefix: string;
  refreshing: boolean;
  onApply: (filters: WorkspaceDocumentsQueryInput) => void;
  onRefresh: () => void;
}) {
  const apply = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const tag = readFormText(form, "tag").trim();
      const status = readFormText(form, "status");
      const filters: WorkspaceDocumentsQueryInput = {};
      if (tag) filters.tag = tag;
      if (
        status === "ready" ||
        status === "processing" ||
        status === "uploaded" ||
        status === "failed" ||
        status === "deleting"
      )
        filters.status = status;
      onApply(filters);
    },
    [onApply],
  );
  const reset = useCallback(() => onApply({}), [onApply]);
  return (
    <form
      onSubmit={apply}
      onReset={reset}
      className="flex flex-wrap items-end gap-3 border-b bg-muted/20 p-4"
    >
      <div className="min-w-36 flex-1 space-y-2">
        <Label htmlFor={`${prefix}-status`}>Status</Label>
        <DocumentSelect id={`${prefix}-status`} name="status">
          <option value="">All statuses</option>
          {Object.entries(documentStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </DocumentSelect>
      </div>
      <div className="min-w-40 flex-1 space-y-2">
        <Label htmlFor={`${prefix}-tag`}>Workspace tag</Label>
        <Input id={`${prefix}-tag`} name="tag" placeholder="e.g. research" maxLength={64} />
      </div>
      <div className="flex gap-2">
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
          <RefreshCw aria-hidden="true" className={refreshing ? "animate-spin" : ""} />
        </Button>
      </div>
    </form>
  );
}

type DocumentSearchInput = Pick<DocumentsQueryInput, "search">;

export function DocumentSearchFilters({
  prefix,
  refreshing,
  onApply,
  onRefresh,
}: {
  prefix: string;
  refreshing: boolean;
  onApply: (filters: DocumentSearchInput) => void;
  onRefresh: () => void;
}) {
  const apply = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      const search = readFormText(new FormData(event.currentTarget), "search").trim();
      onApply(search ? { search } : {});
    },
    [onApply],
  );
  const reset = useCallback(() => onApply({}), [onApply]);

  return (
    <form
      onSubmit={apply}
      onReset={reset}
      className="flex flex-wrap items-end gap-3 border-b bg-muted/20 p-4"
    >
      <div className="min-w-40 flex-1 space-y-2">
        <Label htmlFor={`${prefix}-search`}>Search documents</Label>
        <Input
          id={`${prefix}-search`}
          type="search"
          name="search"
          placeholder="Search by title or filename"
          maxLength={255}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="outline">
          Search
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
          <RefreshCw aria-hidden="true" className={refreshing ? "animate-spin" : ""} />
        </Button>
      </div>
    </form>
  );
}

export function DocumentPagination({
  page,
  hasNext,
  busy,
  onPrevious,
  onNext,
}: {
  page: number;
  hasNext: boolean;
  busy: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <nav
      aria-label="Document pages"
      className="flex items-center justify-between gap-3 border-t p-4"
    >
      <Button variant="outline" size="sm" disabled={page === 1 || busy} onClick={onPrevious}>
        <ChevronLeft aria-hidden="true" /> Previous
      </Button>
      <span className="text-xs text-muted-foreground">Page {page}</span>
      <Button variant="outline" size="sm" disabled={!hasNext || busy} onClick={onNext}>
        Next <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}
