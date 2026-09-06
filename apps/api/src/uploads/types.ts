import type { Document, WorkspaceDocument } from "@repo/db";
import type { ApiRepositories } from "../lib/repository_factory.js";
import type { PreparedUpload } from "./multipart.js";

export type UploadRepositories = {
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

export type DocumentPublication =
  | { kind: "existing"; id: string }
  | { kind: "new"; id: string; objectKey: string };
