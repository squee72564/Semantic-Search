import pino from "pino";
import { type ApiEnv } from "@repo/env/api";

export function createLogger(nodeEnv: ApiEnv["NODE_ENV"]) {
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
