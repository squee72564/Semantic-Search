import { authSchema, type Database } from "@repo/db";
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export type AuthConfig = {
  baseUrl: string;
  nodeEnv: "development" | "test" | "production";
  secret: string;
};

export function createAuth({ config, db }: { config: AuthConfig; db: Database }) {
  const appOrigin = new URL(config.baseUrl).origin;

  return betterAuth({
    secret: config.secret,
    baseURL: config.baseUrl,
    basePath: "/api/auth",
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
    }),
    trustedOrigins: [appOrigin],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    advanced: {
      useSecureCookies: config.nodeEnv === "production",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
