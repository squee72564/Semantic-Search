import { z } from "zod";

export const workerEnvSchema = z.object({
  DATABASE_URL: z.url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function readWorkerEnv(input: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return workerEnvSchema.parse(input);
}
