import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  DocumentDeletingError,
  type Document,
  type UnitOfWork,
  type WorkspaceDocument,
} from "@repo/db";
import type { ObjectStorage } from "@repo/object-storage";
import type { ApiRepositories } from "../lib/repository_factory.js";
import type { Logger } from "../lib/logger.js";
import { throwIfUploadAborted, uploadError } from "./errors.js";
import type { PreparedUpload } from "./multipart.js";
import type { ValidatePdf } from "./pdf.js";

type UploadRepositories = {
  documents: Pick<
    ApiRepositories["documents"],
    "findBySha256" | "findById" | "createOrFind" | "attach"
  >;
  workspaces: Pick<ApiRepositories["workspaces"], "findById">;
  jobs: Pick<ApiRepositories["jobs"], "create" | "findActiveDocumentJob">;
};

export interface UploadResult {
  document: Document;
  attachment: WorkspaceDocument;
  jobId: string | null;
  reused: boolean;
}

export interface UploadInput {
  userId: string;
  workspaceId: string;
  requestId: string;
  signal: AbortSignal;
  prepare: (signal: AbortSignal) => Promise<PreparedUpload>;
}

export type UploadDocument = (input: UploadInput) => Promise<UploadResult>;

export function createUploadService({
  persistence,
  storage,
  validatePdf,
  logger,
  maxConcurrent = 4,
  timeoutMs = 300_000,
}: {
  persistence: UnitOfWork<UploadRepositories>;
  storage: Pick<ObjectStorage, "put" | "head">;
  validatePdf: ValidatePdf;
  logger: Pick<Logger, "warn" | "error">;
  maxConcurrent?: number;
  timeoutMs?: number;
}): UploadDocument {
  let active = 0;
  return async ({ userId, workspaceId, requestId, signal: requestSignal, prepare }) => {
    if (active >= maxConcurrent)
      throw uploadError(
        503,
        "UPLOAD_CAPACITY_EXCEEDED",
        "Upload capacity is busy. Please retry shortly.",
      );
    active += 1;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    timer.unref();
    const signal = AbortSignal.any([requestSignal, deadline.signal]);
    let prepared: PreparedUpload | undefined;
    let objectKey: string | undefined;
    let stage = "prepare";
    let published = false;
    const requireWorkspace = async (repositories: UploadRepositories) => {
      if (!(await repositories.workspaces.findById(userId, workspaceId))) {
        throw uploadError(404, "WORKSPACE_NOT_FOUND", "The requested workspace was not found.");
      }
      throwIfUploadAborted(signal);
    };
    try {
      throwIfUploadAborted(signal);
      await requireWorkspace(persistence.repositories);
      prepared = await prepare(signal);
      await validatePdf(prepared.path, signal);
      throwIfUploadAborted(signal);
      const file = prepared;
      const existing = await persistence.repositories.documents.findBySha256(userId, file.sha256);
      if (existing?.status === "deleting") throw new DocumentDeletingError();
      let allocatedId: string | undefined;
      if (!existing) {
        allocatedId = randomUUID();
        objectKey = `documents/${allocatedId}/original.pdf`;
        stage = "put";
        const body = createReadStream(file.path);
        try {
          await storage.put(
            {
              body,
              key: objectKey,
              contentType: "application/pdf",
              size: file.size,
              sha256: file.sha256,
            },
            { signal },
          );
        } finally {
          body.destroy();
          // Wait for the descriptor to close before Windows temporary-file cleanup.
          if (!body.closed) await new Promise<void>((resolve) => body.once("close", resolve));
        }
        stage = "head";
        const stored = await storage.head(objectKey, { signal });
        if (
          !stored ||
          stored.size !== file.size ||
          stored.contentType !== "application/pdf" ||
          stored.sha256 !== file.sha256
        ) {
          throw uploadError(
            503,
            "UPLOAD_VERIFICATION_FAILED",
            "The stored PDF could not be verified. Please retry.",
          );
        }
      }
      throwIfUploadAborted(signal);
      stage = "transaction";
      const result = await persistence.transaction(async (repositories): Promise<UploadResult> => {
        await requireWorkspace(repositories);
        const resolved = existing
          ? { document: await repositories.documents.findById(userId, existing.id), created: false }
          : await repositories.documents.createOrFind(userId, {
              id: allocatedId!,
              originalObjectKey: objectKey!,
              originalContentType: "application/pdf",
              originalFilename: file.filename,
              originalSizeBytes: file.size,
              sha256: file.sha256,
              title: file.metadata.title,
              description: file.metadata.description,
              customMetadata: file.metadata.customMetadata,
            });
        if (!resolved.document)
          throw uploadError(
            409,
            "DOCUMENT_CHANGED",
            "The document changed during upload. Please retry.",
          );
        if (resolved.document.status === "deleting") throw new DocumentDeletingError();
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
      });
      published = result.document.originalObjectKey === objectKey;
      if (objectKey && !published)
        logger.warn(
          { requestId, objectKey, stage: "duplicate" },
          "uploaded object retained for delayed reconciliation",
        );
      return result;
    } catch (error) {
      if (objectKey && !published)
        logger.warn(
          { requestId, objectKey, stage },
          "publication outcome requires delayed object reconciliation",
        );
      if (error instanceof DocumentDeletingError)
        throw uploadError(
          409,
          "DOCUMENT_DELETING",
          "This document is being deleted. Please retry later.",
        );
      throwIfUploadAborted(signal);
      throw error;
    } finally {
      clearTimeout(timer);
      try {
        await prepared?.cleanup();
      } catch (error) {
        logger.error(
          { err: error, requestId, stage: "temporary_cleanup" },
          "failed to remove upload temporary file",
        );
      }
      active -= 1;
    }
  };
}
