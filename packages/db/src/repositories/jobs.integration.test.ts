import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type ClosePostgresConnFn, type Database } from "../client.js";
import { user } from "../schema/auth.js";
import { createJobRepository, type JobRepository } from "./jobs.js";

const integrationEnabled = process.env.JOB_REPOSITORY_INTEGRATION_TESTS === "true";

describe.runIf(integrationEnabled)("PostgreSQL job repository integration", () => {
  let closeDatabase: ClosePostgresConnFn;
  let db: Database;
  let repository: JobRepository;
  const testRunId = randomUUID();
  const userId = `job-repository-test-${testRunId}`;

  beforeAll(async () => {
    if (process.env.JOB_REPOSITORY_TEST_NON_PRODUCTION !== "true") {
      throw new Error(
        "Set JOB_REPOSITORY_TEST_NON_PRODUCTION=true to confirm the target is non-production",
      );
    }
    const databaseUrl = requiredEnvironmentVariable("JOB_REPOSITORY_TEST_DATABASE_URL");
    ({ close: closeDatabase, db } = createDatabase(databaseUrl));
    repository = createJobRepository(db);
    await db.insert(user).values({
      email: `${userId}@example.invalid`,
      emailVerified: true,
      id: userId,
      name: "Job repository integration test",
    });
  });

  afterAll(async () => {
    if (db !== undefined) await db.delete(user).where(eq(user.id, userId));
    if (closeDatabase !== undefined) await closeDatabase();
  });

  it("converges concurrent idempotent creation on one durable job", async () => {
    const input = {
      availableAt: new Date("2000-01-01T00:00:00.000Z"),
      configurationSchemaVersion: 1,
      idempotencyKey: `${testRunId}:idempotent`,
      kind: "storage_reconciliation" as const,
      maxAttempts: 3,
    };

    const [first, second] = await Promise.all([
      repository.create(userId, input),
      repository.create(userId, input),
    ]);

    expect(first.job.id).toBe(second.job.id);
    expect(
      [first.created, second.created].toSorted((left, right) => Number(left) - Number(right)),
    ).toEqual([false, true]);
  });

  it("never gives the same queued job to concurrent claimers", async () => {
    await Promise.all(
      [1, 2].map((ordinal) =>
        repository.create(userId, {
          availableAt: new Date(`1999-01-0${ordinal}T00:00:00.000Z`),
          configurationSchemaVersion: 1,
          idempotencyKey: `${testRunId}:claim:${ordinal}`,
          kind: "storage_reconciliation",
          maxAttempts: 3,
        }),
      ),
    );

    const [first, second] = await Promise.all([
      repository.claimNext({
        kinds: ["storage_reconciliation"],
        leaseDurationMs: 30_000,
        workerId: `${testRunId}:worker:1`,
      }),
      repository.claimNext({
        kinds: ["storage_reconciliation"],
        leaseDurationMs: 30_000,
        workerId: `${testRunId}:worker:2`,
      }),
    ]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.job.id).not.toBe(second?.job.id);

    await Promise.all(
      [first, second].map((claim) =>
        claim === null
          ? Promise.resolve(false)
          : repository.finishAttempt({
              claimToken: claim.job.claimToken,
              jobId: claim.job.id,
              outcome: "succeeded",
            }),
      ),
    );
  });

  it("closes an expired attempt and makes its job retryable", async () => {
    const { job } = await repository.create(userId, {
      availableAt: new Date("1998-01-01T00:00:00.000Z"),
      configurationSchemaVersion: 1,
      idempotencyKey: `${testRunId}:expired`,
      kind: "storage_reconciliation",
      maxAttempts: 3,
    });
    const claimed = await repository.claimNext({
      kinds: ["storage_reconciliation"],
      leaseDurationMs: 1,
      workerId: `${testRunId}:expiring-worker`,
    });
    expect(claimed?.job.id).toBe(job.id);

    await delay(10);
    await repository.recoverExpired({ limit: 100 });

    await expect(repository.findById(userId, job.id)).resolves.toMatchObject({
      attemptCount: 1,
      claimToken: null,
      status: "queued",
    });
    await expect(repository.listAttempts(userId, job.id)).resolves.toMatchObject([
      { outcome: "lease_expired" },
    ]);
  });
});

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for job repository integration tests`);
  }
  return value;
}
