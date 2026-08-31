import { flushLogger, type Logger } from "./logger.js";

const FORCE_EXIT_TIMEOUT_MS = 10_000;

export type PollForWork = (signal: AbortSignal) => Promise<void>;

interface PollingLoopOptions {
  poll: PollForWork;
  pollIntervalMs: number;
  signal: AbortSignal;
}

interface RunWorkerOptions {
  close: () => Promise<void>;
  logger: Logger;
  poll: PollForWork;
  pollIntervalMs: number;
}

interface ShutdownOptions {
  error?: unknown;
  exitCode?: number;
}

function toError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error("A non-Error value was thrown", { cause: value });
}

function setExitCode(exitCode: number): void {
  if (exitCode !== 0 || process.exitCode === undefined) {
    process.exitCode = exitCode;
  }
}

function waitForNextPoll(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runPollingLoop({
  poll,
  pollIntervalMs,
  signal,
}: PollingLoopOptions): Promise<void> {
  while (!signal.aborted) {
    try {
      // eslint-disable-next-line no-await-in-loop -- each claim attempt must finish before the next poll.
      await poll(signal);
    } catch (error) {
      if (signal.aborted) {
        return;
      }

      throw error;
    }

    // eslint-disable-next-line no-await-in-loop -- polling is intentionally sequential and rate-limited.
    await waitForNextPoll(pollIntervalMs, signal);
  }
}

export async function runWorker({
  close,
  logger,
  poll,
  pollIntervalMs,
}: RunWorkerOptions): Promise<void> {
  const abortController = new AbortController();
  let pollingPromise: Promise<void> | undefined;
  let shutdownPromise: Promise<void> | undefined;

  const removeProcessHandlers = () => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    process.off("uncaughtException", onUncaughtException);
    process.off("unhandledRejection", onUnhandledRejection);
  };

  const shutdown = (
    reason: string,
    { error, exitCode = 0 }: ShutdownOptions = {},
  ): Promise<void> => {
    setExitCode(exitCode);

    if (shutdownPromise) {
      return shutdownPromise;
    }

    abortController.abort();
    shutdownPromise = (async () => {
      let cleanupFailed = false;

      if (error === undefined) {
        logger.info({ reason }, "shutting down worker");
      } else {
        logger.fatal({ err: toError(error), reason }, "shutting down worker after a runtime error");
      }

      const forceExitTimer = setTimeout(() => {
        console.error(`Worker shutdown exceeded ${FORCE_EXIT_TIMEOUT_MS}ms; forcing process exit.`);
        process.exit(1);
      }, FORCE_EXIT_TIMEOUT_MS);

      try {
        await pollingPromise?.catch(() => undefined);

        try {
          await close();
        } catch (closeError) {
          cleanupFailed = true;
          setExitCode(1);
          logger.error({ err: toError(closeError) }, "failed to close worker resources");
        }

        try {
          await flushLogger(logger);
        } catch (flushError) {
          cleanupFailed = true;
          setExitCode(1);
          console.error("Failed to flush the worker logger.", flushError);
        }
      } finally {
        clearTimeout(forceExitTimer);
        removeProcessHandlers();
      }

      if (cleanupFailed) {
        process.exitCode = 1;
      }
    })();

    return shutdownPromise;
  };

  const beginShutdown = (reason: string, options?: ShutdownOptions) => {
    void shutdown(reason, options).catch((shutdownError: unknown) => {
      console.error("Unexpected failure while shutting down the worker.", shutdownError);
      process.exit(1);
    });
  };
  const onSigint = () => {
    if (shutdownPromise) {
      process.exit(1);
    }

    beginShutdown("SIGINT");
  };
  const onSigterm = () => {
    if (shutdownPromise) {
      process.exit(1);
    }

    beginShutdown("SIGTERM");
  };
  const onUncaughtException = (error: Error) => {
    beginShutdown("uncaughtException", { error, exitCode: 1 });
  };
  const onUnhandledRejection = (reason: unknown) => {
    beginShutdown("unhandledRejection", { error: reason, exitCode: 1 });
  };

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  process.once("uncaughtException", onUncaughtException);
  process.once("unhandledRejection", onUnhandledRejection);

  logger.info({ pollIntervalMs }, "worker started");
  pollingPromise = runPollingLoop({ poll, pollIntervalMs, signal: abortController.signal });

  try {
    await pollingPromise;

    if (!shutdownPromise) {
      await shutdown("pollingCompleted");
    }
  } catch (error) {
    await shutdown("pollingError", { error, exitCode: 1 });
  }

  await shutdownPromise;
}
