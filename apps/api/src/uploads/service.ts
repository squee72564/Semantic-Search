import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  DocumentDeletingError,
  PersistenceUnavailableError,
  type ScopedPersistence,
  type PersistenceOptions,
} from "@repo/db";
import type { ObjectStorage } from "@repo/object-storage";
import type { Logger } from "../lib/logger.js";
import { throwIfUploadAborted, uploadError } from "./errors.js";
import type { PreparedUpload } from "./multipart.js";
import type { ValidatePdf } from "./pdf.js";
import { publishDocument, requireWorkspace } from "./publication.js";
import type {
  DocumentPublication,
  UploadDocument,
  UploadRepositories,
  UploadResult,
} from "./types.js";

export type { UploadDocument, UploadInput, UploadResult } from "./types.js";

export function createUploadService({
  persistence,
  storage,
  validatePdf,
  logger,
  maxConcurrent = 4,
  timeoutMs = 300_000,
}: {
  persistence: ScopedPersistence<UploadRepositories>;
  storage: UploadStorage;
  validatePdf: ValidatePdf;
  logger: UploadLogger;
  maxConcurrent?: number;
  timeoutMs?: number;
}): UploadDocument {
  let active = 0;
  return async ({ userId, workspaceId, requestId, signal: requestSignal, prepare }) => {
    requireUploadCapacity(active, maxConcurrent);
    active += 1;
    const { signal, databaseOptions, clearDeadline } = createUploadDeadline(
      requestSignal,
      timeoutMs,
    );
    let prepared: PreparedUpload | undefined;
    const publicationState: PublicationState = { stage: "prepare", published: false };
    try {
      throwIfUploadAborted(signal);
      await persistence.read(
        (repositories) => requireWorkspace(repositories, { userId, workspaceId, signal }),
        databaseOptions,
      );
      prepared = await prepare(signal);
      await validatePdf(prepared.path, signal);
      throwIfUploadAborted(signal);
      const file = prepared;
      const publication = await resolvePublication({
        persistence,
        storage,
        userId,
        file,
        databaseOptions,
        publicationState,
      });
      throwIfUploadAborted(signal);
      publicationState.stage = "transaction";
      const result = await persistence.transaction(
        (repositories, databaseSignal) =>
          publishDocument(repositories, {
            userId,
            workspaceId,
            file,
            publication,
            signal,
            databaseSignal,
          }),
        databaseOptions,
      );
      recordPublicationResult(result, publicationState, logger, requestId);
      return result;
    } catch (error) {
      return throwUploadFailure(error, publicationState, signal, logger, requestId);
    } finally {
      clearDeadline();
      await cleanupPreparedUpload(prepared, logger, requestId);
      active -= 1;
    }
  };
}

// Only these fields change as storage and publication progress. Record the object key
// before PUT so failed writes can still be reconciled, even if their outcome is uncertain.
interface PublicationState {
  objectKey?: string;
  stage: "prepare" | "put" | "head" | "transaction";
  published: boolean;
}

type UploadStorage = Pick<ObjectStorage, "put" | "head">;
type UploadLogger = Pick<Logger, "warn" | "error">;

function requireUploadCapacity(active: number, maxConcurrent: number): void {
  if (active >= maxConcurrent)
    throw uploadError(
      503,
      "UPLOAD_CAPACITY_EXCEEDED",
      "Upload capacity is busy. Please retry shortly.",
    );
}

function createUploadDeadline(requestSignal: AbortSignal, timeoutMs: number) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  timer.unref();
  const signal = AbortSignal.any([requestSignal, deadline.signal]);
  const databaseOptions = { signal, deadline: Date.now() + timeoutMs };
  return { signal, databaseOptions, clearDeadline: () => clearTimeout(timer) };
}

async function resolvePublication({
  persistence,
  storage,
  userId,
  file,
  databaseOptions,
  publicationState,
}: {
  persistence: ScopedPersistence<UploadRepositories>;
  storage: UploadStorage;
  userId: string;
  file: PreparedUpload;
  databaseOptions: PersistenceOptions;
  publicationState: PublicationState;
}): Promise<DocumentPublication> {
  const existing = await persistence.read(
    (repositories) => repositories.documents.findBySha256(userId, file.sha256),
    databaseOptions,
  );
  if (existing?.status === "deleting") throw new DocumentDeletingError();
  if (existing) return { kind: "existing", id: existing.id };

  const id = randomUUID();
  const objectKey = `documents/${id}/original.pdf`;
  publicationState.objectKey = objectKey;
  publicationState.stage = "put";
  await putOriginalPdf(storage, file, objectKey, databaseOptions.signal);
  publicationState.stage = "head";
  await verifyStoredPdf(storage, file, objectKey, databaseOptions.signal);
  return { kind: "new", id, objectKey };
}

async function putOriginalPdf(
  storage: UploadStorage,
  file: PreparedUpload,
  objectKey: string,
  signal: AbortSignal,
): Promise<void> {
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
}

async function verifyStoredPdf(
  storage: UploadStorage,
  file: PreparedUpload,
  objectKey: string,
  signal: AbortSignal,
): Promise<void> {
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

function recordPublicationResult(
  result: UploadResult,
  state: PublicationState,
  logger: UploadLogger,
  requestId: string,
): void {
  state.published = result.document.originalObjectKey === state.objectKey;
  if (state.objectKey && !state.published)
    logger.warn(
      { requestId, objectKey: state.objectKey, stage: "duplicate" },
      "uploaded object retained for delayed reconciliation",
    );
}

function throwUploadFailure(
  error: unknown,
  state: PublicationState,
  signal: AbortSignal,
  logger: UploadLogger,
  requestId: string,
): never {
  if (state.objectKey && !state.published)
    logger.warn(
      { requestId, objectKey: state.objectKey, stage: state.stage },
      "publication outcome requires delayed object reconciliation",
    );
  throwIfUploadAborted(signal);
  if (error instanceof PersistenceUnavailableError) {
    logger.warn({ err: error, requestId, stage: error.phase }, "upload database unavailable");
    throw uploadError(
      503,
      "UPLOAD_DATABASE_UNAVAILABLE",
      "Upload persistence is temporarily unavailable. Please retry shortly.",
    );
  }
  throw error;
}

async function cleanupPreparedUpload(
  prepared: PreparedUpload | undefined,
  logger: UploadLogger,
  requestId: string,
): Promise<void> {
  try {
    await prepared?.cleanup();
  } catch (error) {
    logger.error(
      { err: error, requestId, stage: "temporary_cleanup" },
      "failed to remove upload temporary file",
    );
  }
}
