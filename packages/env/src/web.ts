import { z } from "zod";

export const webServerEnvSchema = z.object({
  API_INTERNAL_URL: z.url().default("http://localhost:3001"),
});

export type WebServerEnv = z.infer<typeof webServerEnvSchema>;

export function readWebServerEnv(input: NodeJS.ProcessEnv = process.env): WebServerEnv {
  return webServerEnvSchema.parse(input);
}
