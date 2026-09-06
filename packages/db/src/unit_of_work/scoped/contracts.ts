export interface PersistenceOptions {
  signal: AbortSignal;
  /** Absolute deadline in milliseconds since the Unix epoch. */
  deadline: number;
}

/** Database access leased exclusively for each callback, unlike long-lived UnitOfWork repositories. */
export interface ScopedPersistence<T> {
  /**
   * Runs without an explicit transaction; does not enforce read-only SQL.
   * Repositories belong to this callback's scope. Await all database calls and
   * check the supplied phase signal before further work.
   */
  read<R>(
    operation: (repositories: T, signal: AbortSignal) => Promise<R>,
    options: PersistenceOptions,
  ): Promise<R>;
  /**
   * Resolves after commit. Repositories belong to this transaction's callback scope.
   * Await all database calls and check the supplied phase signal before further work.
   */
  transaction<R>(
    operation: (repositories: T, signal: AbortSignal) => Promise<R>,
    options: PersistenceOptions,
  ): Promise<R>;
}

export interface Connection<T> {
  read<R>(operation: (repositories: T) => Promise<R>): Promise<R>;
  transaction<R>(operation: (repositories: T) => Promise<R>): Promise<R>;
  // force=true must cause in-flight database operations to reject.
  close(force: boolean): Promise<void>;
}

export interface PoolOptions {
  max: number;
  acquireTimeoutMs?: number;
  phaseTimeoutMs?: number;
  settlementTimeoutMs?: number;
}

export interface ScopedPersistenceOptions extends PoolOptions {
  connectTimeoutMs?: number;
  statementTimeoutMs?: number;
  lockTimeoutMs?: number;
}

export interface PostgresConnectionOptions {
  connectTimeoutMs: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  phaseTimeoutMs: number | undefined;
}
