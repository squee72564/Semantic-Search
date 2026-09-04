import { createAuth } from "@repo/auth";
import { createDatabase, createUnitOfWork } from "@repo/db";
import { readApiEnv } from "@repo/env/api";
import { createApp } from "./app.js";
import { createLogger, flushLogger, type Logger } from "./lib/logger.js";
import { startServer } from "./lib/server.js";
import { createApiRepositories } from "./lib/repository_factory.js";
import { createS3Storage, type ObjectStorage } from "@repo/object-storage";
import { createPdfValidator } from "./uploads/pdf.js";
import { createUploadService } from "./uploads/service.js";

async function main(): Promise<void> {
  let logger: Logger | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let storage: ObjectStorage | undefined;

  try {
    const env = readApiEnv();
    logger = createLogger(env.NODE_ENV);

    const { db, close } = createDatabase(env.DATABASE_URL);
    closeDatabase = close;

    const persistence = createUnitOfWork(db, createApiRepositories);
    storage = createS3Storage({
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      bucket: env.S3_BUCKET,
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
    const uploadDocument = createUploadService({
      persistence,
      storage,
      logger,
      validatePdf: createPdfValidator({
        executable: env.PDFINFO_PATH,
        timeoutMs: env.PDF_VALIDATION_TIMEOUT_MS,
      }),
      maxConcurrent: env.UPLOAD_MAX_CONCURRENT,
      timeoutMs: env.UPLOAD_TIMEOUT_MS,
    });

    const auth = createAuth({
      db,
      config: {
        baseUrl: env.BETTER_AUTH_URL,
        nodeEnv: env.NODE_ENV,
        secret: env.BETTER_AUTH_SECRET,
      },
    });

    const app = createApp({
      auth,
      documents: persistence.repositories.documents,
      workspaces: persistence.repositories.workspaces,
      env,
      logger,
      uploadDocument,
    });

    startServer({
      app,
      close: async () => {
        try {
          storage?.close();
        } finally {
          await close();
        }
      },
      env,
      logger,
    });
  } catch (error) {
    process.exitCode = 1;
    storage?.close();

    if (!logger) {
      console.error("Failed to initialize the API server.", error);
      return;
    }

    logger.fatal({ err: error }, "failed to initialize the API server");

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
      console.error("Failed to flush the API logger.", flushError);
    }
  }
}

await main();
