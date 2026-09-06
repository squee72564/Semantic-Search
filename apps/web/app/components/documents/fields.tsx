import type { ComponentProps } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";
import type { DocumentMetadataInput, DocumentStatus } from "~/queries/documents";

export type WorkspaceOption = { id: string; name: string };

export function DocumentSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function WorkspaceSelect({
  workspaces,
  placeholder = "Choose a workspace",
  ...props
}: ComponentProps<"select"> & { workspaces: WorkspaceOption[]; placeholder?: string }) {
  return (
    <DocumentSelect {...props}>
      <option value="">{placeholder}</option>
      {workspaces.map((workspace) => (
        <option key={workspace.id} value={workspace.id}>
          {workspace.name}
        </option>
      ))}
    </DocumentSelect>
  );
}

export const documentStatusLabels: Record<DocumentStatus, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
  deleting: "Deleting",
};
const statusClasses: Record<DocumentStatus, string> = {
  uploaded: "bg-muted text-muted-foreground",
  processing: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  ready: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/10 text-destructive",
  deleting: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
};
export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
        statusClasses[status],
      )}
    >
      {documentStatusLabels[status]}
    </span>
  );
}

export function DocumentError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {error instanceof Error
        ? error.message
        : "The request could not be completed. Please try again."}
    </p>
  );
}

export function formatDocumentSize(bytes: number) {
  return bytes < 1024 ** 2
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function MetadataFields({
  prefix,
  title = "",
  description = "",
}: {
  prefix: string;
  title?: string;
  description?: string;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-title`}>Title (optional)</Label>
        <Input id={`${prefix}-title`} name="title" defaultValue={title} maxLength={255} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-description`}>Description (optional)</Label>
        <Textarea
          id={`${prefix}-description`}
          name="description"
          defaultValue={description}
          maxLength={10000}
          className="min-h-24"
        />
      </div>
    </>
  );
}

export function readDocumentMetadata(form: FormData): DocumentMetadataInput {
  return {
    title: readFormText(form, "title").trim() || null,
    description: readFormText(form, "description").trim() || null,
  };
}

export function readAttachmentMetadata(form: FormData) {
  return {
    displayTitle: readFormText(form, "displayTitle").trim() || null,
    tags: readFormText(form, "tags")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

export function readFormText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function AttachmentFields({
  prefix,
  displayTitle,
  tags,
}: {
  prefix: string;
  displayTitle?: string | null | undefined;
  tags?: string[] | undefined;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-title`}>Workspace display title</Label>
        <Input
          id={`${prefix}-title`}
          name="displayTitle"
          defaultValue={displayTitle ?? ""}
          maxLength={255}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-tags`}>Tags</Label>
        <Input
          id={`${prefix}-tags`}
          name="tags"
          defaultValue={tags?.join(", ") ?? ""}
          placeholder="research, reference"
        />
        <p className="text-xs text-muted-foreground">
          Separate tags with commas. Up to 32 tags, 64 characters each.
        </p>
      </div>
    </>
  );
}
