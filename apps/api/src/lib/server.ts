import { createAdaptorServer, type ServerType } from "@hono/node-server";
import type { ApiEnv } from "@repo/env/api";

import type { AppType } from "../app.js";
import { flushLogger, type Logger } from "./logger.js";

const SERVER_CLOSE_TIMEOUT_MS = 8_000;
const FORCE_EXIT_TIMEOUT_MS = 10_000;

type CloseDatabase = () => Promise<void>;

interface ShutdownOptions {
  error?: unknown;
  exitCode?: number;
}

function toError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error("A non-Error value was thrown", { cause: value });
}

function isServerNotRunningError(error: Error): boolean {
  return "code" in error && error.code === "ERR_SERVER_NOT_RUNNING";
}

function closeServer(apiServer: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (error && !isServerNotRunningError(error)) {
        reject(error);
        return;
      }

      resolve();
    };

    const timeout = setTimeout(() => {
      if (
        "closeAllConnections" in apiServer &&
        typeof apiServer.closeAllConnections === "function"
      ) {
        apiServer.closeAllConnections();
      }

      settle(new Error("Timed out while closing the HTTP server"));
    }, SERVER_CLOSE_TIMEOUT_MS);

    apiServer.close((error) => {
      settle(error);
    });
  });
}

function setExitCode(exitCode: number): void {
  if (exitCode !== 0 || process.exitCode === undefined) {
    process.exitCode = exitCode;
  }
}

export function startServer({
  app,
  close,
  env,
  logger,
}: {
  app: AppType;
  close: CloseDatabase;
  env: ApiEnv;
  logger: Logger;
}): ServerType {
  const apiServer = createAdaptorServer({ fetch: app.fetch });
  let shutdownPromise: Promise<void> | undefined;

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

    shutdownPromise = (async () => {
      let cleanupFailed = false;

      if (error === undefined) {
        logger.info({ reason }, "shutting down API server");
      } else {
        logger.fatal(
          { err: toError(error), reason },
          "shutting down API server after a runtime error",
        );
      }

      const forceExitTimer = setTimeout(() => {
        console.error(`API shutdown exceeded ${FORCE_EXIT_TIMEOUT_MS}ms; forcing process exit.`);
        process.exit(1);
      }, FORCE_EXIT_TIMEOUT_MS);

      try {
        try {
          await closeServer(apiServer);
        } catch (closeError) {
          cleanupFailed = true;
          setExitCode(1);
          logger.error({ err: toError(closeError) }, "failed to close the HTTP server cleanly");
        }

        try {
          await close();
        } catch (closeError) {
          cleanupFailed = true;
          setExitCode(1);
          logger.error({ err: toError(closeError) }, "failed to close the database connection");
        }

        try {
          await flushLogger(logger);
        } catch (flushError) {
          cleanupFailed = true;
          setExitCode(1);
          console.error("Failed to flush the API logger.", flushError);
        }
      } finally {
        clearTimeout(forceExitTimer);
        removeProcessHandlers();
      }

      if (cleanupFailed) {
        process.exit(1);
      }
    })();

    return shutdownPromise;
  };

  const beginShutdown = (reason: string, options?: ShutdownOptions) => {
    void shutdown(reason, options).catch((shutdownError: unknown) => {
      console.error("Unexpected failure while shutting down the API server.", shutdownError);
      process.exit(1);
    });
  };

  const onServerError = (error: Error) => {
    beginShutdown("serverError", { error, exitCode: 1 });
  };

  apiServer.once("error", onServerError);
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  process.once("uncaughtException", onUncaughtException);
  process.once("unhandledRejection", onUnhandledRejection);

  try {
    apiServer.listen(env.API_PORT, env.API_HOST, () => {
      const address = apiServer.address();

      logger.info(
        {
          host: typeof address === "string" ? address : address?.address,
          port: typeof address === "string" ? env.API_PORT : address?.port,
        },
        "API server listening",
      );
    });
  } catch (error) {
    removeProcessHandlers();
    apiServer.off("error", onServerError);
    throw error;
  }

  return apiServer;
}
