import type { RepositoryFactory } from "./index.js";
import type { ScopedPersistence, ScopedPersistenceOptions } from "./scoped/contracts.js";
import { createScopedPool } from "./scoped/pool.js";
import { createPostgresConnection } from "./scoped/postgres-connection.js";

export type { PersistenceOptions, ScopedPersistence } from "./scoped/contracts.js";
export { PersistenceUnavailableError } from "./scoped/errors.js";
export { createScopedPool } from "./scoped/pool.js";

/** An exclusive client per database phase allows cancellation to retire only that client. */
export function createScopedPersistence<T>(
  databaseUrl: string,
  factory: RepositoryFactory<T>,
  options: ScopedPersistenceOptions,
): ScopedPersistence<T> & { close(): Promise<void> } {
  const connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
  const statementTimeoutMs = options.statementTimeoutMs ?? 15_000;
  const lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
  for (const value of [connectTimeoutMs, statementTimeoutMs, lockTimeoutMs]) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError("Database timeouts must be positive integers");
  }
  return createScopedPool(
    () =>
      createPostgresConnection(databaseUrl, factory, {
        connectTimeoutMs,
        statementTimeoutMs,
        lockTimeoutMs,
        phaseTimeoutMs: options.phaseTimeoutMs,
      }),
    options,
  );
}
