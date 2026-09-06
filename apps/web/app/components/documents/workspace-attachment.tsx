import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState, type ChangeEvent, type SubmitEvent } from "react";
import { Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Spinner } from "~/components/ui/spinner";
import { browserApiClient } from "~/lib/api.client";
import {
  attachDocumentMutation,
  detachDocumentMutation,
  documentAttachmentQuery,
  refreshDocuments,
  updateDocumentAttachmentMutation,
} from "~/queries/documents";
import { sidebarWorkspacesQuery } from "~/queries/workspaces";
import {
  DocumentError,
  readAttachmentMetadata,
  WorkspaceSelect,
  type WorkspaceOption,
} from "./fields";

const noWorkspaces: WorkspaceOption[] = [];

export function WorkspaceAttachment({
  documentId,
  disabled,
}: {
  documentId: string;
  disabled: boolean;
}) {
  const [workspaceId, setWorkspaceId] = useState("");
  const workspaces = useQuery(sidebarWorkspacesQuery(browserApiClient));
  const selectWorkspace = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => setWorkspaceId(event.target.value),
    [],
  );
  const { refetch: refetchWorkspaces } = workspaces;
  const retryWorkspaces = useCallback(() => {
    void refetchWorkspaces();
  }, [refetchWorkspaces]);
  return (
    <section className="space-y-4 border-t pt-5">
      <div>
        <h3 className="font-semibold">Workspace attachments</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a workspace to attach this document or manage its existing copy.
        </p>
      </div>
      <Label htmlFor="attachment-workspace">Workspace to manage</Label>
      <WorkspaceSelect
        id="attachment-workspace"
        value={workspaceId}
        onChange={selectWorkspace}
        workspaces={workspaces.data?.items ?? noWorkspaces}
        disabled={disabled || workspaces.isPending}
      />
      {workspaces.isPending ? (
        <Spinner />
      ) : workspaces.error ? (
        <>
          <DocumentError error={workspaces.error} />
          <Button variant="outline" onClick={retryWorkspaces}>
            Retry workspaces
          </Button>
        </>
      ) : !workspaces.data?.items.length ? (
        <Link to="/workspaces" className="text-sm underline">
          Create a workspace to organize documents
        </Link>
      ) : null}
      {workspaceId ? (
        <AttachmentEditor
          key={workspaceId}
          workspaceId={workspaceId}
          documentId={documentId}
          disabled={disabled}
        />
      ) : null}
    </section>
  );
}

function AttachmentEditor({
  workspaceId,
  documentId,
  disabled,
}: {
  workspaceId: string;
  documentId: string;
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const attachment = useQuery(documentAttachmentQuery(browserApiClient, workspaceId, documentId));
  const [notice, setNotice] = useState("");
  const attach = useMutation({
    ...attachDocumentMutation(browserApiClient),
    onSuccess: () => refreshDocuments(queryClient),
  });
  const update = useMutation({
    ...updateDocumentAttachmentMutation(browserApiClient),
    onSuccess: () => refreshDocuments(queryClient),
  });
  const detach = useMutation({
    ...detachDocumentMutation(browserApiClient),
    onSuccess: () => refreshDocuments(queryClient),
  });
  const pending = attach.isPending || update.isPending || detach.isPending;
  const resetFeedback = useCallback(() => {
    setNotice("");
    attach.reset();
    update.reset();
    detach.reset();
  }, [attach, update, detach]);
  const submit = useCallback(
    async (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      resetFeedback();
      const metadata = readAttachmentMetadata(new FormData(event.currentTarget));
      try {
        await (attachment.data ? update : attach).mutateAsync({
          workspaceId,
          documentId,
          attachment: metadata,
        });
        setNotice(attachment.data ? "Workspace details saved." : "Document attached to workspace.");
      } catch {
        /* Mutation errors are displayed below without discarding form values. */
      }
    },
    [resetFeedback, attachment.data, update, attach, workspaceId, documentId],
  );
  const remove = useCallback(async () => {
    resetFeedback();
    try {
      await detach.mutateAsync({ workspaceId, documentId });
      setNotice("Document detached. It remains in your library.");
    } catch {
      /* Keep the current attachment and display its error. */
    }
  }, [resetFeedback, detach, workspaceId, documentId]);
  const { refetch: refetchAttachment } = attachment;
  const retry = useCallback(() => {
    void refetchAttachment();
  }, [refetchAttachment]);
  if (attachment.isPending) return <Spinner />;
  if (attachment.error)
    return (
      <div className="space-y-2">
        <DocumentError error={attachment.error} />
        <Button variant="outline" onClick={retry}>
          Retry attachment
        </Button>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border p-4">
      <p className="text-sm font-medium">
        {attachment.data ? "Attached to this workspace" : "Not attached to this workspace"}
      </p>
      <fieldset
        key={attachment.data?.updatedAt ?? "new"}
        disabled={disabled || pending}
        className="space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="attachment-title">Workspace display title</Label>
          <Input
            id="attachment-title"
            name="displayTitle"
            defaultValue={attachment.data?.displayTitle ?? ""}
            maxLength={255}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="attachment-tags">Tags</Label>
          <Input
            id="attachment-tags"
            name="tags"
            defaultValue={attachment.data?.tags.join(", ") ?? ""}
            placeholder="research, reference"
          />
          <p className="text-xs text-muted-foreground">
            Separate tags with commas. Up to 32 tags, 64 characters each.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm">
            {pending
              ? "Saving…"
              : attachment.data
                ? "Save workspace details"
                : "Attach to workspace"}
          </Button>
          {attachment.data ? (
            <Button type="button" variant="outline" size="sm" onClick={remove}>
              Detach from workspace
            </Button>
          ) : null}
        </div>
      </fieldset>
      <DocumentError error={attach.error ?? update.error ?? detach.error} />
      {notice ? <output className="block text-sm text-muted-foreground">{notice}</output> : null}
    </form>
  );
}
