import { z } from "zod";

const s3RegionSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u, "Invalid S3 region");

const s3BucketSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u, "Invalid S3 bucket name")
  .refine((bucket) => !bucket.includes(".."), "Invalid S3 bucket name");

const s3EndpointSchema = z.url().refine((endpoint) => {
  const { protocol } = new URL(endpoint);

  return protocol === "http:" || protocol === "https:";
}, "S3 endpoint must use HTTP or HTTPS");

const booleanStringSchema = z.enum(["true", "false"]).transform((value) => value === "true");

export const apiEnvSchema = z.object({
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url().default("http://localhost:5173"),
  DATABASE_URL: z.url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_BUCKET: s3BucketSchema,
  S3_ENDPOINT: s3EndpointSchema,
  S3_FORCE_PATH_STYLE: booleanStringSchema.default(false),
  S3_REGION: s3RegionSchema,
  S3_SECRET_ACCESS_KEY: z.string().min(1),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function readApiEnv(input: NodeJS.ProcessEnv = process.env): ApiEnv {
  return apiEnvSchema.parse(input);
}
