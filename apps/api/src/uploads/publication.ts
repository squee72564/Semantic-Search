import { DocumentDeletingError } from "@repo/db";
import { throwIfUploadAborted, uploadError } from "./errors.js";
import type { PreparedUpload } from "./multipart.js";
import type { DocumentPublication, UploadRepositories, UploadResult } from "./types.js";

export async function requireWorkspace(
  repositories: UploadRepositories,
  {
    userId,
    workspaceId,
    signal,
  }: {
    userId: string;
    workspaceId: string;
    signal: AbortSignal;
  },
): Promise<void> {
  if (!(await repositories.workspaces.findById(userId, workspaceId))) {
    throw uploadError(404, "WORKSPACE_NOT_FOUND", "The requested workspace was not found.");
  }
  throwIfUploadAborted(signal);
}

/** Publishes through the caller's transaction-bound repositories; does not open a transaction. */
export async function publishDocument(
  repositories: UploadRepositories,
  {
    userId,
    workspaceId,
    file,
    publication,
    signal,
    databaseSignal,
  }: {
    userId: string;
    workspaceId: string;
    file: PreparedUpload;
    publication: DocumentPublication;
    signal: AbortSignal;
    databaseSignal: AbortSignal;
  },
): Promise<UploadResult> {
  await requireWorkspace(repositories, { userId, workspaceId, signal });
  databaseSignal.throwIfAborted();
  const resolved =
    publication.kind === "existing"
      ? {
          document: await repositories.documents.findById(userId, publication.id),
          created: false,
        }
      : await repositories.documents.createOrFind(userId, {
          id: publication.id,
          originalObjectKey: publication.objectKey,
          originalContentType: "application/pdf",
          originalFilename: file.filename,
          originalSizeBytes: file.size,
          sha256: file.sha256,
          title: file.metadata.title,
          description: file.metadata.description,
          customMetadata: file.metadata.customMetadata,
        });
  if (!resolved.document)
    throw uploadError(409, "DOCUMENT_CHANGED", "The document changed during upload. Please retry.");
  if (resolved.document.status === "deleting") throw new DocumentDeletingError();
  databaseSignal.throwIfAborted();
  const attachment = await repositories.documents.attach(
    userId,
    workspaceId,
    resolved.document.id,
    {
      displayTitle: file.metadata.displayTitle,
      tags: file.metadata.tags,
    },
  );
  if (!attachment)
    throw uploadError(
      404,
      "WORKSPACE_DOCUMENT_NOT_FOUND",
      "The document or workspace is no longer available.",
    );
  databaseSignal.throwIfAborted();
  const job = resolved.created
    ? (
        await repositories.jobs.create(userId, {
          kind: "document_processing",
          documentId: resolved.document.id,
          startStage: "preflight",
          configurationSchemaVersion: 1,
          configuration: {},
          maxAttempts: 3,
          idempotencyKey: `document:${resolved.document.id}:initial-processing`,
        })
      ).job
    : await repositories.jobs.findActiveDocumentJob(userId, resolved.document.id);
  if (
    job &&
    (job.userId !== userId ||
      job.documentId !== resolved.document.id ||
      job.kind !== "document_processing")
  ) {
    throw new Error("Processing job does not match the uploaded document");
  }
  throwIfUploadAborted(signal);
  return {
    document: resolved.document,
    attachment,
    jobId: job?.id ?? null,
    reused: !resolved.created,
  };
}
