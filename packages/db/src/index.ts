export { createDatabase, type Database, type ClosePostgresConnFn } from "./client.js";
export * as authSchema from "./schema/auth.js";
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
