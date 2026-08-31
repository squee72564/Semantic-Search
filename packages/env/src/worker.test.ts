import { describe, expect, it } from "vitest";

import { workerEnvSchema } from "./worker.js";

const databaseUrl = "postgres://postgres:postgres@localhost:5432/squee_online";

describe("workerEnvSchema", () => {
  it("supplies worker defaults", () => {
    const env = workerEnvSchema.parse({ DATABASE_URL: databaseUrl });

    expect(env.NODE_ENV).toBe("development");
    expect(env.WORKER_POLL_INTERVAL_MS).toBe(1_000);
  });

  it("coerces an explicit polling interval", () => {
    const env = workerEnvSchema.parse({
      DATABASE_URL: databaseUrl,
      WORKER_POLL_INTERVAL_MS: "2500",
    });

    expect(env.WORKER_POLL_INTERVAL_MS).toBe(2_500);
  });

  it.each(["99", "60001", "not-a-number"])("rejects invalid polling interval %s", (interval) => {
    expect(() =>
      workerEnvSchema.parse({
        DATABASE_URL: databaseUrl,
        WORKER_POLL_INTERVAL_MS: interval,
      }),
    ).toThrow(/WORKER_POLL_INTERVAL_MS/u);
  });
});
