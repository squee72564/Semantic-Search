import { createDatabase } from "@repo/db";
import { readWorkerEnv } from "@repo/env/worker";
import { createLogger, flushLogger, type Logger } from "./lib/logger.js";
import { runWorker, type PollForWork } from "./lib/worker.js";

// The PostgreSQL JobConsumer will replace this placeholder once the jobs schema and repository exist.
const pollForWork: PollForWork = () => Promise.resolve();

async function main(): Promise<void> {
  let logger: Logger | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;

  try {
    const env = readWorkerEnv();
    logger = createLogger(env.NODE_ENV);

    const { close } = createDatabase(env.DATABASE_URL);
    closeDatabase = close;

    await runWorker({
      close,
      logger,
      poll: pollForWork,
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    });
  } catch (error) {
    process.exitCode = 1;

    if (!logger) {
      console.error("Failed to initialize the Ingest Worker.", error);
      return;
    }

    logger.fatal({ err: error }, "failed to initialize the Ingest Worker");

    if (closeDatabase) {
      try {
        await closeDatabase();
      } catch (closeError) {
        logger.error(
          { err: closeError },
          "failed to close the database after an initialization error",
        );
      }
    }

    try {
      await flushLogger(logger);
    } catch (flushError) {
      console.error("Failed to flush the Ingest Worker logger.", flushError);
    }
  }
}

await main();
