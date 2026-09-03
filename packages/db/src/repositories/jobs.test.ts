import { drizzle } from "drizzle-orm/postgres-js";
import { describe, expect, it } from "vitest";

import * as schema from "../schema/index.js";
import { createJobRepository } from "./jobs.js";

interface CapturedQuery {
  parameters: readonly unknown[];
  sql: string;
}

const createdAt = new Date("2026-09-01T12:00:00.000Z");
const updatedAt = new Date("2026-09-01T12:01:00.000Z");
const availableAt = new Date("2026-09-01T12:02:00.000Z");
const leaseExpiresAt = new Date("2026-09-01T12:03:00.000Z");
const userId = "user-1";
const jobId = "00000000-0000-4000-8000-000000000001";
const documentId = "00000000-0000-4000-8000-000000000002";
const claimToken = "00000000-0000-4000-8000-000000000003";

function jobRow({
  attemptCount = 0,
  cancellationRequestedAt = null,
  claimedBy = null,
  claim = null,
  finishedAt = null,
  lease = null,
  maxAttempts = 3,
  status = "queued",
}: {
  attemptCount?: number;
  cancellationRequestedAt?: Date | null;
  claimedBy?: string | null;
  claim?: string | null;
  finishedAt?: Date | null;
  lease?: Date | null;
  maxAttempts?: number;
  status?: "cancelled" | "failed" | "queued" | "running" | "succeeded";
} = {}): unknown[] {
  return [
    jobId,
    "document_processing",
    userId,
    documentId,
    status,
    "upload:1",
    "preflight",
    "preflight",
    1,
    {},
    attemptCount,
    maxAttempts,
    availableAt,
    null,
    null,
    null,
    cancellationRequestedAt,
    claimedBy,
    claim,
    lease,
    null,
    null,
    finishedAt,
    createdAt,
    updatedAt,
  ];
}

function attemptRow({ outcome = null }: { outcome?: string | null } = {}): unknown[] {
  return [
    "00000000-0000-4000-8000-000000000004",
    jobId,
    1,
    "worker-1",
    claimToken,
    createdAt,
    updatedAt,
    outcome === null ? null : updatedAt,
    outcome,
    null,
    null,
    {},
  ];
}

function createRecordingDatabase(responses: unknown[][][]) {
  const queries: CapturedQuery[] = [];
  const client: {
    begin: <T>(callback: (transactionClient: typeof client) => Promise<T>) => Promise<T>;
    options: { parsers: Record<string, never>; serializers: Record<string, never> };
    savepoint: <T>(callback: (transactionClient: typeof client) => Promise<T>) => Promise<T>;
    unsafe: (sql: string, parameters: readonly unknown[]) => { values: () => Promise<unknown[][]> };
  } = {
    begin: (callback) => callback(client),
    options: { parsers: {}, serializers: {} },
    savepoint: (callback) => callback(client),
    unsafe(sql, parameters) {
      queries.push({ parameters, sql });
      const response = responses.shift() ?? [];
      return { values: () => Promise.resolve(response) };
    },
  };
  // @ts-expect-error The recording client intentionally implements only the postgres-js methods used here.
  const db = drizzle(client, { schema });

  return { db, queries };
}

describe("Job repository", () => {
  it("creates a document job with its current stage initialized and reuses an idempotent job", async () => {
    const { db, queries } = createRecordingDatabase([[jobRow()], [], [jobRow()]]);
    const repository = createJobRepository(db);
    const input = {
      configurationSchemaVersion: 1,
      documentId,
      idempotencyKey: "upload:1",
      kind: "document_processing" as const,
      maxAttempts: 3,
      startStage: "preflight" as const,
    };

    await expect(repository.create(userId, input)).resolves.toMatchObject({ created: true });
    await expect(repository.create(userId, input)).resolves.toMatchObject({
      created: false,
      job: { id: jobId, userId },
    });

    expect(queries[0]?.sql).toContain('insert into "jobs"');
    expect(queries[0]?.sql).toContain("on conflict do nothing");
    expect(queries[0]?.parameters.filter((value) => value === "preflight")).toHaveLength(2);
    expect(queries[2]?.sql).toContain('"jobs"."idempotency_key"');
    expect(queries[2]?.parameters).toEqual([userId, "upload:1", 1]);
  });

  it("scopes job and attempt reads and paginates filtered user history", async () => {
    const secondJobId = "00000000-0000-4000-8000-000000000005";
    const second = [...jobRow()];
    second[0] = secondJobId;
    const { db, queries } = createRecordingDatabase([
      [jobRow()],
      [jobRow()],
      [jobRow(), second],
      [attemptRow()],
    ]);
    const repository = createJobRepository(db);

    await repository.findById(userId, jobId);
    await repository.findActiveDocumentJob(userId, documentId);
    const page = await repository.list({
      cursor: { createdAt: updatedAt, id: secondJobId },
      documentId,
      kind: "document_processing",
      limit: 1,
      status: "queued",
      userId,
    });
    const attempts = await repository.listAttempts(userId, jobId);

    expect(page).toMatchObject({ items: [{ id: jobId }], nextCursor: { id: jobId } });
    expect(attempts).toMatchObject([{ claimToken, jobId }]);
    for (const query of queries) expect(query.parameters).toContain(userId);
    expect(queries[2]?.sql).toContain('order by "jobs"."created_at" desc, "jobs"."id" desc');
    expect(queries[3]?.sql).toContain('inner join "jobs"');
  });

  it("claims available work and creates its attempt in one transaction", async () => {
    const running = jobRow({
      attemptCount: 1,
      claimedBy: "worker-1",
      claim: claimToken,
      lease: leaseExpiresAt,
      status: "running",
    });
    const { db, queries } = createRecordingDatabase([[jobRow()], [running], [attemptRow()]]);
    const repository = createJobRepository(db);

    const claimed = await repository.claimNext({ leaseDurationMs: 30_000, workerId: "worker-1" });

    expect(claimed).toMatchObject({
      attempt: { attemptNumber: 1, jobId },
      job: { attemptCount: 1, claimedBy: "worker-1", status: "running" },
    });
    expect(queries[0]?.sql).toContain("for update skip locked");
    expect(queries[0]?.sql).toContain('"jobs"."available_at" <= now()');
    expect(queries[1]?.sql).toContain('update "jobs" set');
    expect(queries[2]?.sql).toContain('insert into "job_attempts"');
    expect(queries[1]?.parameters).toContain(30_000);
  });

  it("guards heartbeats and progress updates with the active claim token", async () => {
    const { db, queries } = createRecordingDatabase([
      [[null, leaseExpiresAt]],
      [[null, leaseExpiresAt]],
    ]);
    const repository = createJobRepository(db);

    await expect(
      repository.renewLease({ claimToken, jobId, leaseDurationMs: 15_000 }),
    ).resolves.toEqual({ cancellationRequestedAt: null, leaseExpiresAt });
    await expect(
      repository.reportProgress({
        claimToken,
        completed: 2,
        currentStage: "extraction",
        jobId,
        total: 5,
      }),
    ).resolves.toEqual({ cancellationRequestedAt: null, leaseExpiresAt });

    for (const query of queries) {
      expect(query.sql).toContain('"jobs"."claim_token"');
      expect(query.sql).toContain('"jobs"."lease_expires_at" > now()');
      expect(query.parameters).toContain(claimToken);
    }
    expect(queries[1]?.parameters).toEqual(
      expect.arrayContaining(["extraction", 2, 5, jobId, claimToken]),
    );
  });

  it("cancels queued jobs immediately and flags running jobs", async () => {
    const { db, queries } = createRecordingDatabase([
      [jobRow()],
      [],
      [
        jobRow({
          attemptCount: 1,
          claimedBy: "worker-1",
          claim: claimToken,
          lease: leaseExpiresAt,
          status: "running",
        }),
      ],
      [],
    ]);
    const repository = createJobRepository(db);

    await expect(repository.requestCancellation(userId, jobId)).resolves.toBe("cancelled");
    await expect(repository.requestCancellation(userId, jobId)).resolves.toBe("requested");

    expect(queries[1]?.sql).toContain('"status" = $1');
    expect(queries[1]?.parameters).toContain("cancelled");
    expect(queries[3]?.sql).toContain('"cancellation_requested_at" = now()');
  });

  it("atomically records retryable completion and requeues when attempts remain", async () => {
    const active = jobRow({
      attemptCount: 1,
      claimedBy: "worker-1",
      claim: claimToken,
      lease: leaseExpiresAt,
      status: "running",
    });
    const { db, queries } = createRecordingDatabase([[active], [], [[jobId]]]);
    const repository = createJobRepository(db);

    await expect(
      repository.finishAttempt({
        availableAt,
        claimToken,
        errorCode: "provider_unavailable",
        errorDetails: { provider: "test" },
        errorMessage: "Try again",
        jobId,
        outcome: "retryable_failure",
      }),
    ).resolves.toBe(true);

    expect(queries[1]?.sql).toContain('update "job_attempts"');
    expect(queries[1]?.parameters).toContain("retryable_failure");
    expect(queries[2]?.sql).toContain('update "jobs"');
    expect(queries[2]?.parameters).toContain("queued");
    expect(queries[2]?.parameters).toContain(claimToken);
  });

  it("accepts an identical terminal retry but rejects a stale incompatible transition", async () => {
    const { db } = createRecordingDatabase([[], [["succeeded"]], [], [["succeeded"]]]);
    const repository = createJobRepository(db);

    await expect(
      repository.finishAttempt({ claimToken, jobId, outcome: "succeeded" }),
    ).resolves.toBe(true);
    await expect(
      repository.finishAttempt({
        claimToken,
        errorCode: "late_failure",
        jobId,
        outcome: "terminal_failure",
      }),
    ).resolves.toBe(false);
  });

  it("recovers expired jobs according to cancellation and attempt limits", async () => {
    const cancelled = jobRow({
      attemptCount: 1,
      cancellationRequestedAt: updatedAt,
      claimedBy: "worker-1",
      claim: claimToken,
      lease: leaseExpiresAt,
      status: "running",
    });
    const { db, queries } = createRecordingDatabase([[cancelled], [], []]);
    const repository = createJobRepository(db);

    await expect(repository.recoverExpired({ limit: 10 })).resolves.toEqual({
      cancelled: 1,
      failed: 0,
      requeued: 0,
    });

    expect(queries[0]?.sql).toContain("for update skip locked");
    expect(queries[1]?.parameters).toContain("lease_expired");
    expect(queries[2]?.parameters).toContain("cancelled");
  });

  it("validates lease, progress, and recovery bounds before querying", async () => {
    const { db, queries } = createRecordingDatabase([]);
    const repository = createJobRepository(db);

    await expect(repository.claimNext({ leaseDurationMs: 0, workerId: "worker" })).rejects.toThrow(
      RangeError,
    );
    await expect(
      repository.reportProgress({ claimToken, completed: 2, jobId, total: 1 }),
    ).rejects.toThrow(RangeError);
    await expect(repository.recoverExpired({ limit: 0 })).rejects.toThrow(RangeError);
    expect(queries).toHaveLength(0);
  });
});
