import pino from "pino";
import { type WorkerEnv } from "@repo/env/worker";

export function createLogger(nodeEnv: WorkerEnv["NODE_ENV"]) {
  return pino({
    level: "info",
    ...(nodeEnv === "development" && {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
        },
      },
    }),
  });
}

export function flushLogger(logger: Logger): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.flush((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export type Logger = ReturnType<typeof createLogger>;
