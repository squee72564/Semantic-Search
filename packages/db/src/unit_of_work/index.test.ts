import { describe, expect, it, vi } from "vitest";
import type { Database, DatabaseExecutor, DatabaseTransaction } from "../client.js";
import { createUnitOfWork } from "./index.js";

describe("unit of work binding", () => {
  it("binds fresh repositories to the transaction and waits for commit", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Identity-only executor fixture; no database operations are invoked.
    const tx = {} as DatabaseTransaction;
    let committed = false;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Only transaction dispatch is exercised by this unit test; real rollback has a PostgreSQL integration suite.
    const db = {
      transaction: async <T>(operation: (tx: DatabaseTransaction) => Promise<T>) => {
        const result = await operation(tx);
        committed = true;
        return result;
      },
    } as Database;
    const factory = vi.fn<(executor: DatabaseExecutor) => { executor: DatabaseExecutor }>(
      (executor) => ({ executor }),
    );
    const uow = createUnitOfWork(db, factory);
    expect(uow.repositories.executor).toBe(db);
    const result = await uow.transaction(async (repositories) => {
      expect(repositories.executor).toBe(tx);
      expect(repositories).not.toBe(uow.repositories);
      expect(committed).toBe(false);
      return "published";
    });
    expect(result).toBe("published");
    expect(committed).toBe(true);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
