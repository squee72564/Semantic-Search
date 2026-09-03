import type { Database, DatabaseExecutor } from "../client.js";

export interface UnitOfWork<TRepositories> {
  /**
   * Long-lived repositories backed by the normal connection pool.
   */
  readonly repositories: TRepositories;

  /**
   * Runs the operation with repositories bound to one transaction.
   * Resolves with the operation's return value after commit.
   * Throws after rollback when the operation fails.
   */
  transaction<TResult>(
    operation: (repositories: TRepositories) => Promise<TResult>,
  ): Promise<TResult>;
}

export type RepositoryFactory<TRepositories> = (executor: DatabaseExecutor) => TRepositories;

export function createUnitOfWork<TRepositories>(
  db: Database,
  createRepositories: RepositoryFactory<TRepositories>,
): UnitOfWork<TRepositories> {
  const repositories = createRepositories(db);

  return {
    repositories,

    transaction<TResult>(
      operation: (repositories: TRepositories) => Promise<TResult>,
    ): Promise<TResult> {
      return db.transaction((tx) => {
        const transactionRepositories = createRepositories(tx);
        return operation(transactionRepositories);
      });
    },
  };
}
