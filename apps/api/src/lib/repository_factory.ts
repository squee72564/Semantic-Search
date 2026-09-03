import {
  createDocumentRepository,
  createJobRepository,
  createWorkspaceRepository,
  type DatabaseExecutor,
} from "@repo/db";

export function createApiRepositories(executor: DatabaseExecutor) {
  return {
    documents: createDocumentRepository(executor),
    jobs: createJobRepository(executor),
    workspaces: createWorkspaceRepository(executor),
  };
}

export type ApiRepositories = ReturnType<typeof createApiRepositories>;
