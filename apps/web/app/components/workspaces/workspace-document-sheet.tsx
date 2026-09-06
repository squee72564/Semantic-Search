import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, type SubmitEvent } from "react";
import { toast } from "sonner";
import {
  AttachmentFields,
  DocumentError,
  readAttachmentMetadata,
} from "~/components/documents/fields";
import { Button } from "~/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { browserApiClient } from "~/lib/api.client";
import {
  refreshDocuments,
  updateDocumentAttachmentMutation,
  type WorkspaceDocumentItem,
} from "~/queries/documents";

export function WorkspaceDocumentSheet({
  item,
  onClose,
  onCloseAutoFocus,
  onSaved,
}: {
  item: WorkspaceDocumentItem;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...updateDocumentAttachmentMutation(browserApiClient),
    onSuccess: async () => {
      onSaved();
      await refreshDocuments(queryClient);
      toast.success("Workspace details saved.");
      onClose();
    },
  });
  const changeOpen = useCallback(
    (open: boolean) => {
      if (!open && !mutation.isPending) onClose();
    },
    [onClose, mutation.isPending],
  );
  const submit = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      mutation.mutate({
        workspaceId: item.attachment.workspaceId,
        documentId: item.document.id,
        attachment: readAttachmentMetadata(new FormData(event.currentTarget)),
      });
    },
    [mutation, item],
  );
  return (
    <Sheet open onOpenChange={changeOpen}>
      <SheetContent
        onCloseAutoFocus={onCloseAutoFocus}
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Edit workspace details</SheetTitle>
          <SheetDescription>
            Change how this document appears in this workspace. Library metadata stays the same.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="space-y-5 p-4">
          <p className="break-words text-sm text-muted-foreground">
            {item.document.title || item.document.originalFilename}
          </p>
          <fieldset disabled={mutation.isPending} className="space-y-4">
            <AttachmentFields
              prefix="workspace-document"
              displayTitle={item.attachment.displayTitle}
              tags={item.attachment.tags}
            />
            <Button type="submit">
              {mutation.isPending ? "Saving…" : "Save workspace details"}
            </Button>
          </fieldset>
          <DocumentError error={mutation.error} />
        </form>
      </SheetContent>
    </Sheet>
  );
}
