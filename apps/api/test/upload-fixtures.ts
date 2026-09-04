import type { Document, Job, Workspace, WorkspaceDocument } from "@repo/db";

export const userId = "upload-user";
export const workspaceId = "0198b3f4-6fb4-7000-8000-000000000002";
export const documentId = "0198b3f4-6fb4-7000-8000-000000000001";
const now = new Date("2026-09-04T00:00:00Z");
export const document: Document = {
  id: documentId,
  userId,
  sha256: "a".repeat(64),
  originalFilename: "original.pdf",
  originalContentType: "application/pdf",
  originalObjectKey: `documents/${documentId}/original.pdf`,
  originalSizeBytes: 20,
  status: "uploaded",
  title: null,
  description: null,
  customMetadata: {},
  pageCount: null,
  createdAt: now,
  updatedAt: now,
};
export const workspace: Workspace = {
  id: workspaceId,
  userId,
  name: "Research",
  description: null,
  createdAt: now,
  updatedAt: now,
};
export const attachment: WorkspaceDocument = {
  workspaceId,
  documentId,
  userId,
  displayTitle: null,
  tags: [],
  attachedAt: now,
  updatedAt: now,
};
export const job: Job = {
  id: "0198b3f4-6fb4-7000-8000-000000000003",
  userId,
  documentId,
  kind: "document_processing",
  status: "queued",
  idempotencyKey: `document:${documentId}:initial-processing`,
  startStage: "preflight",
  currentStage: "preflight",
  configurationSchemaVersion: 1,
  configuration: {},
  attemptCount: 0,
  maxAttempts: 3,
  availableAt: now,
  progressCompleted: null,
  progressTotal: null,
  progressUpdatedAt: null,
  cancellationRequestedAt: null,
  claimedBy: null,
  claimToken: null,
  leaseExpiresAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  finishedAt: null,
  createdAt: now,
  updatedAt: now,
};

export function multipartBody(
  file: string | Uint8Array = "%PDF-1.7\ncontent\n",
  metadata?: string,
  filename = "source.pdf",
) {
  const boundary = "upload-test-boundary";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    Buffer.from(file),
    Buffer.from("\r\n"),
    ...(metadata === undefined
      ? []
      : [
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${metadata}\r\n`,
          ),
        ]),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

export function uploadRequest(
  body = multipartBody(),
  options: { signal?: AbortSignal; contentLength?: string } = {},
): Request {
  return new Request(`http://localhost/workspaces/${workspaceId}/documents`, {
    method: "POST",
    body: body.body,
    headers: {
      "content-type": body.contentType,
      "sec-fetch-site": "same-origin",
      ...(options.contentLength === undefined ? {} : { "content-length": options.contentLength }),
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}
