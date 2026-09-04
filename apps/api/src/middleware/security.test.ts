import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { apiEnvSchema, type ApiEnv } from "@repo/env/api";
import type { AppVariables } from "../lib/context.js";
import { createRequestIdMiddleware } from "./request-id.js";
import { createCsrfProtection, createSecurityMiddleware } from "./security.js";

const createTestApp = (nodeEnv: ApiEnv["NODE_ENV"] = "test") => {
  const env = apiEnvSchema.parse({
    API_HOST: "127.0.0.1",
    API_PORT: 3001,
    BETTER_AUTH_SECRET: "test-auth-secret-with-at-least-32-characters",
    BETTER_AUTH_URL: "http://localhost:5173",
    DATABASE_URL: "postgres://localhost/test",
    NODE_ENV: nodeEnv,
    S3_ACCESS_KEY_ID: "test-access-key",
    S3_BUCKET: "semantic-search-test",
    S3_ENDPOINT: "https://fsn1.your-objectstorage.com",
    S3_FORCE_PATH_STYLE: "false",
    S3_REGION: "fsn1",
    S3_SECRET_ACCESS_KEY: "test-secret-key",
  });
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("*", createRequestIdMiddleware());
  app.use("*", ...createSecurityMiddleware(env));
  app.use("*", createCsrfProtection(env));
  app.get("/resource", (context) => context.json({ ok: true }));
  app.post("/resource", async (context) => {
    await context.req.text();
    return context.json({ ok: true });
  });

  return app;
};

describe("security middleware", () => {
  it("sets restrictive API headers without HSTS outside production", async () => {
    const response = await createTestApp().request("/resource");

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("strict-transport-security")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("sets HSTS in production", async () => {
    const response = await createTestApp("production").request("/resource");

    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
  });

  it("allows same-origin form requests", async () => {
    const response = await createTestApp().request("/resource", {
      body: "title=test",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "sec-fetch-site": "same-origin",
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
  });

  it("rejects cross-site form requests with problem details", async () => {
    const response = await createTestApp().request("/resource", {
      body: "title=test",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      code: "CSRF_VALIDATION_FAILED",
      instance: "/resource",
      status: 403,
    });
  });

  it("falls back to exact Origin validation for legacy clients", async () => {
    const app = createTestApp();
    const allowed = await app.request("http://localhost/resource", {
      body: "title=test",
      headers: {
        "content-type": "text/plain",
        origin: "http://localhost",
      },
      method: "POST",
    });
    const rejected = await app.request("http://localhost/resource", {
      body: "title=test",
      headers: {
        "content-type": "text/plain",
        origin: "http://localhost.attacker.example",
      },
      method: "POST",
    });

    expect(allowed.status).toBe(200);
    expect(rejected.status).toBe(403);
  });

  it("does not let a missing Content-Type bypass CSRF protection", async () => {
    const response = await createTestApp().request("/resource", {
      body: "unsafe request",
      method: "POST",
    });

    expect(response.status).toBe(403);
  });

  it("rejects request bodies larger than one MiB", async () => {
    const response = await createTestApp().request("/resource", {
      body: "x".repeat(1024 * 1024 + 1),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    await expect(response.json()).resolves.toMatchObject({
      code: "REQUEST_BODY_TOO_LARGE",
      status: 413,
    });
  });
});
