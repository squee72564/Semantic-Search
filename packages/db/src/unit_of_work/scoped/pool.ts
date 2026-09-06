import type {
  Connection,
  PersistenceOptions,
  PoolOptions,
  ScopedPersistence,
} from "./contracts.js";
import { isDatabaseUnavailable, PersistenceUnavailableError } from "./errors.js";

interface ConnectionSlot<T> {
  connection?: Connection<T>;
  busy: boolean;
}

/** @internal Injectable connection boundary for lifecycle tests. */
export function createScopedPool<T>(
  connect: () => Connection<T>,
  {
    max,
    acquireTimeoutMs = 5_000,
    phaseTimeoutMs = 30_000,
    settlementTimeoutMs = 2_000,
  }: PoolOptions,
): ScopedPersistence<T> & { close(): Promise<void> } {
  for (const value of [max, acquireTimeoutMs, phaseTimeoutMs, settlementTimeoutMs]) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError("Pool bounds must be positive integers");
  }
  const shutdown = new AbortController();
  const slots: ConnectionSlot<T>[] = Array.from({ length: max }, () => ({ busy: false }));
  const waiters = new Set<() => void>();
  const running = new Set<Promise<unknown>>();
  let closing: Promise<void> | undefined;

  async function acquireSlot(signal: AbortSignal) {
    const findAvailableSlot = () => slots.find((slot) => !slot.busy);
    signal.throwIfAborted();
    const slot = findAvailableSlot();
    if (slot) {
      slot.busy = true;
      return slot;
    }
    return new Promise<ConnectionSlot<T>>((resolve, reject) => {
      const wake = () => {
        const next = findAvailableSlot();
        if (!next) return;
        next.busy = true;
        cleanup();
        resolve(next);
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new PersistenceUnavailableError("acquire"));
      }, acquireTimeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        // Removing the waiter prevents cancelled or timed-out work from starting later.
        waiters.delete(wake);
        signal.removeEventListener("abort", abort);
      };
      waiters.add(wake);
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  async function runPhase<R>(
    phase: "read" | "transaction",
    operation: (repositories: T, signal: AbortSignal) => Promise<R>,
    options: PersistenceOptions,
  ): Promise<R> {
    const phaseDeadlineController = new AbortController();
    const timer = setTimeout(
      () => phaseDeadlineController.abort(new PersistenceUnavailableError(phase)),
      Math.max(0, Math.min(phaseTimeoutMs, options.deadline - Date.now())),
    );
    const signal = AbortSignal.any([
      options.signal,
      phaseDeadlineController.signal,
      shutdown.signal,
    ]);
    let slot: ConnectionSlot<T> | undefined;
    let forcedClosePromise: Promise<void> | undefined;
    let forceCloseTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleForcedClose = () => {
      forceCloseTimer ??= setTimeout(() => {
        if (slot?.connection) {
          forcedClosePromise = slot.connection.close(true);
          void forcedClosePromise.catch(() => {});
        }
      }, settlementTimeoutMs);
    };
    try {
      if (options.deadline <= Date.now()) throw new PersistenceUnavailableError(phase);
      slot = await acquireSlot(signal);
      signal.throwIfAborted();
      const connection = (slot.connection ??= connect());
      signal.addEventListener("abort", scheduleForcedClose, { once: true });
      const result = await connection[phase](async (repositories) => {
        signal.throwIfAborted();
        const value = await operation(repositories, signal);
        // This check runs inside the transaction, before COMMIT is sent.
        signal.throwIfAborted();
        return value;
      });
      // A confirmed commit remains success even if cancellation arrived during COMMIT.
      return result;
    } catch (error) {
      if (signal.aborted || isDatabaseUnavailable(error)) {
        throw new PersistenceUnavailableError(phase, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      clearTimeout(forceCloseTimer);
      signal.removeEventListener("abort", scheduleForcedClose);
      if (slot) {
        try {
          if (forcedClosePromise) await forcedClosePromise;
        } finally {
          // Discard a retired client before making its slot available again.
          if (forcedClosePromise) delete slot.connection;
          slot.busy = false;
          waiters.values().next().value?.();
        }
      }
    }
  }

  function trackPhase<R>(
    phase: "read" | "transaction",
    operation: (repositories: T, signal: AbortSignal) => Promise<R>,
    options: PersistenceOptions,
  ) {
    const pending = runPhase(phase, operation, options);
    running.add(pending);
    void pending.finally(() => running.delete(pending)).catch(() => {});
    return pending;
  }

  return {
    read: (operation, options) => trackPhase("read", operation, options),
    transaction: (operation, options) => trackPhase("transaction", operation, options),
    close() {
      closing ??= (async () => {
        shutdown.abort(new PersistenceUnavailableError("acquire"));
        await Promise.allSettled(running);
        await Promise.all(
          slots.map(async (slot) => {
            await slot.connection?.close(false);
          }),
        );
      })();
      return closing;
    },
  };
}
