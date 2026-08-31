import { describe, expect, it } from "vitest";

import { apiEnvSchema } from "./api.js";

const databaseUrl = "postgres://postgres:postgres@localhost:5432/squee_online";
const authSecret = "test-auth-secret-with-at-least-32-characters";
const storageEnv = {
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_BUCKET: "semantic-search-development",
  S3_ENDPOINT: "https://fsn1.your-objectstorage.com",
  S3_REGION: "fsn1",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
};

describe("apiEnvSchema", () => {
  it("coerces the port and supplies local defaults", () => {
    const env = apiEnvSchema.parse({
      API_PORT: "4100",
      BETTER_AUTH_SECRET: authSecret,
      DATABASE_URL: databaseUrl,
      ...storageEnv,
    });

    expect(env.API_PORT).toBe(4100);
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:5173");
    expect(env.DATABASE_URL).toContain("squee_online");
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it("rejects invalid ports", () => {
    expect(() =>
      apiEnvSchema.parse({
        API_PORT: "70000",
        BETTER_AUTH_SECRET: authSecret,
        DATABASE_URL: databaseUrl,
        ...storageEnv,
      }),
    ).toThrow(/65_535|65535|Too big/u);
  });

  it("requires a database URL", () => {
    expect(() => apiEnvSchema.parse({ BETTER_AUTH_SECRET: authSecret, ...storageEnv })).toThrow(
      /DATABASE_URL/u,
    );
  });

  it("requires an authentication secret", () => {
    expect(() => apiEnvSchema.parse({ DATABASE_URL: databaseUrl, ...storageEnv })).toThrow(
      /BETTER_AUTH_SECRET/u,
    );
  });

  it("accepts the required database and authentication credentials", () => {
    expect(() =>
      apiEnvSchema.parse({
        BETTER_AUTH_SECRET: authSecret,
        DATABASE_URL: databaseUrl,
        ...storageEnv,
      }),
    ).not.toThrow();
  });

  it("parses an explicit path-style setting", () => {
    const env = apiEnvSchema.parse({
      BETTER_AUTH_SECRET: authSecret,
      DATABASE_URL: databaseUrl,
      ...storageEnv,
      S3_FORCE_PATH_STYLE: "true",
    });

    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it.each(["S3_ACCESS_KEY_ID", "S3_BUCKET", "S3_ENDPOINT", "S3_REGION", "S3_SECRET_ACCESS_KEY"])(
    "requires %s",
    (key) => {
      const input: Record<string, string> = {
        BETTER_AUTH_SECRET: authSecret,
        DATABASE_URL: databaseUrl,
        ...storageEnv,
      };
      delete input[key];

      expect(() => apiEnvSchema.parse(input)).toThrow(new RegExp(key, "u"));
    },
  );

  it.each([
    ["endpoint", { S3_ENDPOINT: "not-a-url" }, /Invalid URL/u],
    ["endpoint protocol", { S3_ENDPOINT: "ftp://fsn1.your-objectstorage.com" }, /HTTP or HTTPS/u],
    ["region", { S3_REGION: "FSN 1" }, /Invalid S3 region/u],
    ["bucket", { S3_BUCKET: "production_bucket" }, /Invalid S3 bucket name/u],
    ["addressing style", { S3_FORCE_PATH_STYLE: "yes" }, /Invalid option/u],
  ])("rejects a malformed S3 %s", (_name, override, message) => {
    expect(() =>
      apiEnvSchema.parse({
        BETTER_AUTH_SECRET: authSecret,
        DATABASE_URL: databaseUrl,
        ...storageEnv,
        ...override,
      }),
    ).toThrow(message);
  });
});
