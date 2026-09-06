import { afterEach, describe, expect, it, vi } from "vitest";
import { createScopedPool, PersistenceUnavailableError } from "./scoped.js";

const options = (signal = new AbortController().signal) => ({
  signal,
  deadline: Date.now() + 10_000,
});
const deferred = <T = void>() => Promise.withResolvers<T>();

describe("scoped persistence lifecycle", () => {
  afterEach(() => vi.useRealTimers());

  function fixture(max = 1) {
    let count = 0;
    const closes = new Map<number, ReturnType<typeof vi.fn>>();
    const commits = vi.fn<() => void>();
    const pool = createScopedPool(
      () => {
        const id = ++count;
        const terminated = deferred<never>();
        // Rejection is observed by any active operation, including a stalled commit.
        void terminated.promise.catch(() => {});
        const close = vi.fn<(force: boolean) => Promise<void>>(async (force) => {
          if (force) terminated.reject(new Error("connection terminated"));
        });
        closes.set(id, close);
        const repositories = { id };
        return {
          read: <R>(operation: (repositories: { id: number }) => Promise<R>) =>
            Promise.race([operation(repositories), terminated.promise]),
          transaction: async <R>(operation: (repositories: { id: number }) => Promise<R>) => {
            const value = await Promise.race([operation(repositories), terminated.promise]);
            commits();
            return value;
          },
          close,
        };
      },
      { max, acquireTimeoutMs: 50, phaseTimeoutMs: 200, settlementTimeoutMs: 20 },
    );
    return { pool, closes, commits };
  }

  it("removes cancelled acquisition waiters so their callbacks can never run", async () => {
    const { pool } = fixture();
    const entered = deferred();
    const release = deferred();
    const first = pool.read(async () => {
      entered.resolve();
      await release.promise;
    }, options());
    await entered.promise;
    const controller = new AbortController();
    const callback = vi.fn<() => Promise<void>>(async () => {});
    const waiting = pool.transaction(callback, options(controller.signal));
    const rejected = waiting.catch((error: unknown) => error);
    controller.abort();
    expect(await rejected).toBeInstanceOf(PersistenceUnavailableError);
    release.resolve();
    await first;
    await pool.read(async () => {}, options());
    expect(callback).not.toHaveBeenCalled();
    await pool.close();
  });

  it("bounds acquisition without retiring the busy client", async () => {
    vi.useFakeTimers();
    const { pool, closes } = fixture();
    const release = deferred();
    const entered = deferred();
    const first = pool.read(async () => {
      entered.resolve();
      await release.promise;
    }, options());
    await entered.promise;
    const callback = vi.fn<() => Promise<void>>(async () => {});
    const waiting = pool.read(callback, options()).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(50);
    expect(await waiting).toMatchObject({ phase: "acquire" });
    release.resolve();
    await first;
    expect(callback).not.toHaveBeenCalled();
    expect(closes.get(1)).not.toHaveBeenCalled();
    await pool.close();
  });

  it("checks cancellation inside the transaction before committing", async () => {
    const { pool, commits, closes } = fixture();
    const controller = new AbortController();
    await expect(
      pool.transaction(async () => {
        controller.abort();
        return "must roll back";
      }, options(controller.signal)),
    ).rejects.toBeInstanceOf(PersistenceUnavailableError);
    expect(commits).not.toHaveBeenCalled();
    expect(closes.get(1)).not.toHaveBeenCalled();
    expect(await pool.read(async ({ id }) => id, options())).toBe(1);
    await pool.close();
  });

  it("retires only the unresponsive lease and permits other uploads and replacement", async () => {
    vi.useFakeTimers();
    const { pool, closes } = fixture(2);
    const entered = deferred();
    const never = deferred();
    const pending = pool.read(async () => {
      entered.resolve();
      await never.promise;
    }, options());
    const failed = pending.catch((error: unknown) => error);
    await entered.promise;
    expect(await pool.read(async ({ id }) => id, options())).toBe(2);
    await vi.advanceTimersByTimeAsync(220);
    expect(await failed).toBeInstanceOf(PersistenceUnavailableError);
    expect(closes.get(1)).toHaveBeenCalledWith(true);
    expect(closes.get(2)).not.toHaveBeenCalled();
    expect(await pool.read(async ({ id }) => id, options())).toBe(3);
    await pool.close();
  });

  it("does not run callbacks with an expired deadline", async () => {
    const { pool } = fixture();
    const callback = vi.fn<() => Promise<void>>(async () => {});
    await expect(
      pool.read(callback, { ...options(), deadline: Date.now() - 1 }),
    ).rejects.toBeInstanceOf(PersistenceUnavailableError);
    expect(callback).not.toHaveBeenCalled();
    await pool.close();
  });

  it("waits for forced settlement on shutdown and rejects new work", async () => {
    vi.useFakeTimers();
    const { pool } = fixture();
    const entered = deferred();
    const never = deferred();
    const failed = pool
      .read(async () => {
        entered.resolve();
        await never.promise;
      }, options())
      .catch((error: unknown) => error);
    await entered.promise;
    const closing = pool.close();
    await vi.advanceTimersByTimeAsync(20);
    expect(await failed).toBeInstanceOf(PersistenceUnavailableError);
    await closing;
    await expect(pool.read(async () => {}, options())).rejects.toBeInstanceOf(
      PersistenceUnavailableError,
    );
  });

  it("returns a confirmed commit even if cancellation arrives while COMMIT settles", async () => {
    const controller = new AbortController();
    const pool = createScopedPool(
      () => ({
        read: async <R>(operation: (repositories: object) => Promise<R>) => operation({}),
        transaction: async <R>(operation: (repositories: object) => Promise<R>) => {
          const value = await operation({});
          controller.abort();
          return value;
        },
        close: async () => {},
      }),
      { max: 1 },
    );
    expect(await pool.transaction(async () => "committed", options(controller.signal))).toBe(
      "committed",
    );
    await pool.close();
  });

  it.each(["57014", "55P03", "53300", "ECONNREFUSED"])(
    "maps database failure %s through query wrappers",
    async (code) => {
      const { pool } = fixture();
      await expect(
        pool.read(async () => {
          throw new Error("query failed", {
            cause: Object.assign(new Error("database failure"), { code }),
          });
        }, options()),
      ).rejects.toBeInstanceOf(PersistenceUnavailableError);
      await pool.close();
    },
  );
});
