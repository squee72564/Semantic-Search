export { createDatabase, type Database, type ClosePostgresConnFn } from "./client.js";
export { createCursorPage, type CursorPage } from "./repositories/pagination.js";
export {
  createDocumentRepository,
  type AttachDocumentInput,
  type CreateDocumentInput,
  type DocumentCursor,
  type DocumentPage,
  type DocumentRepository,
  type ListDocumentsInput,
  type ListWorkspaceDocumentsInput,
  type UpdateDocumentMetadataInput,
  type UpdateWorkspaceDocumentInput,
  type WorkspaceDocumentCursor,
  type WorkspaceDocumentListItem,
  type WorkspaceDocumentPage,
} from "./repositories/documents.js";
export * as authSchema from "./schema/auth.js";
export {
  documents,
  documentStatus,
  type Document,
  type DocumentStatus,
  type NewDocument,
} from "./schema/documents.js";
export {
  documentProcessingStage,
  jobAttempts,
  jobAttemptOutcome,
  jobKind,
  jobs,
  jobStatus,
  type DocumentProcessingStage,
  type Job,
  type JobAttempt,
  type JobAttemptOutcome,
  type JobConfiguration,
  type JobErrorDetails,
  type JobKind,
  type JobStatus,
  type NewJob,
  type NewJobAttempt,
} from "./schema/jobs.js";
export {
  workspaceDocuments,
  type NewWorkspaceDocument,
  type WorkspaceDocument,
} from "./schema/workspace-documents.js";
export { workspaces, type NewWorkspace, type Workspace } from "./schema/workspaces.js";
export {
  createWorkspaceRepository,
  type CreateWorkspaceInput,
  type ListWorkspacesInput,
  type UpdateWorkspaceInput,
  type WorkspaceCursor,
  type WorkspacePage,
  type WorkspaceRepository,
} from "./repositories/workspaces.js";
