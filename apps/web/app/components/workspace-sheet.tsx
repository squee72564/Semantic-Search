import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useCallback, type SubmitEvent } from "react";
import { useNavigate } from "react-router";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";
import { browserApiClient } from "~/lib/api.client";
import {
  createWorkspaceMutation,
  updateWorkspaceMutation,
  workspaceQueryKeys,
  type CreateWorkspaceInput,
} from "~/queries/workspaces";

interface WorkspaceFormItem {
  description: string | null;
  id: string;
  name: string;
}

function readWorkspaceForm(form: HTMLFormElement): CreateWorkspaceInput {
  const formData = new FormData(form);
  const name = formData.get("name");
  const description = formData.get("description");
  const normalizedDescription = typeof description === "string" ? description.trim() : "";

  return {
    name: typeof name === "string" ? name.trim() : "",
    description: normalizedDescription || null,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to save the workspace. Please try again.";
}

export function CreateWorkspaceSheet({
  open,
  onOpenChange,
  showTrigger = true,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...createWorkspaceMutation(browserApiClient),
    onSuccess: async ({ item }) => {
      await queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.lists() });
      await navigate(`/workspaces/${item.id}`);
    },
  });
  const handleSubmit = useCallback(
    async (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        await mutation.mutateAsync(readWorkspaceForm(event.currentTarget));
      } catch {
        // Keep the sheet and its uncontrolled form values in place; render the error below.
      }
    },
    [mutation],
  );

  return (
    <Sheet {...(open === undefined ? {} : { open })} {...(onOpenChange ? { onOpenChange } : {})}>
      {showTrigger ? (
        <SheetTrigger asChild>
          <Button>
            <Plus aria-hidden="true" /> Create workspace
          </Button>
        </SheetTrigger>
      ) : null}
      <WorkspaceFormContent
        title="Create workspace"
        description="Give this workspace a name. You can add more context now or later."
        submitLabel={mutation.isPending ? "Creating…" : "Create workspace"}
        error={mutation.error}
        isPending={mutation.isPending}
        onSubmit={handleSubmit}
      />
    </Sheet>
  );
}

export function EditWorkspaceSheet({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: WorkspaceFormItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...updateWorkspaceMutation(browserApiClient),
    onSuccess: async ({ item }) => {
      queryClient.setQueryData(workspaceQueryKeys.detail(item.id), { item });
      await queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.lists() });
      onOpenChange(false);
    },
  });
  const handleSubmit = useCallback(
    async (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        await mutation.mutateAsync({
          id: workspace.id,
          workspace: readWorkspaceForm(event.currentTarget),
        });
      } catch {
        // Keep values and show the mutation error.
      }
    },
    [mutation, workspace.id],
  );
  const handleCancel = useCallback(() => onOpenChange(false), [onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open ? (
        <WorkspaceFormContent
          key={workspace.id}
          title="Edit workspace"
          description="Update the name and description shown throughout your workspace directory."
          workspace={workspace}
          submitLabel={mutation.isPending ? "Saving…" : "Save changes"}
          error={mutation.error}
          isPending={mutation.isPending}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      ) : null}
    </Sheet>
  );
}

function WorkspaceFormContent({
  title,
  description,
  workspace,
  submitLabel,
  error,
  isPending,
  onSubmit,
  onCancel,
}: {
  title: string;
  description: string;
  workspace?: WorkspaceFormItem;
  submitLabel: string;
  error: unknown;
  isPending: boolean;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
  onCancel?: () => void;
}) {
  const prefix = workspace ? "edit" : "create";
  return (
    <SheetContent className="overflow-y-auto sm:max-w-lg">
      <SheetHeader className="border-b pr-12">
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>
      <form className="flex flex-1 flex-col" onSubmit={onSubmit}>
        <div className="flex-1 space-y-5 px-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${prefix}-workspace-name`}>Name</Label>
            <Input
              id={`${prefix}-workspace-name`}
              name="name"
              defaultValue={workspace?.name}
              maxLength={255}
              required
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${prefix}-workspace-description`}>
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id={`${prefix}-workspace-description`}
              name="description"
              defaultValue={workspace?.description ?? ""}
              maxLength={10_000}
              className="min-h-36 resize-y"
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {getErrorMessage(error)}
            </p>
          ) : null}
        </div>
        <SheetFooter className="border-t sm:flex-row sm:justify-end">
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" disabled={isPending}>
            {submitLabel}
          </Button>
        </SheetFooter>
      </form>
    </SheetContent>
  );
}
