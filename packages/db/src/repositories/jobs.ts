import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";

import type { Database } from "../client.js";
import {
  jobAttempts,
  jobs,
  type DocumentProcessingStage,
  type Job,
  type JobAttempt,
  type JobConfiguration,
  type JobErrorDetails,
  type JobKind,
  type JobStatus,
} from "../schema/jobs.js";
import { createCursorPage, type CursorPage } from "./pagination.js";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type JobRepositoryExecutor = Database | DatabaseTransaction;

export interface JobCursor {
  createdAt: Date;
  id: string;
}

interface CreateJobInputBase {
  availableAt?: Date | undefined;
  configuration?: JobConfiguration | undefined;
  configurationSchemaVersion: number;
  idempotencyKey: string;
  maxAttempts: number;
}

export interface CreateDocumentProcessingJobInput extends CreateJobInputBase {
  documentId: string;
  kind: "document_processing";
  startStage: DocumentProcessingStage;
}

export interface CreateMaintenanceJobInput extends CreateJobInputBase {
  documentId?: string | null | undefined;
  kind: Exclude<JobKind, "document_processing">;
}

export type CreateJobInput = CreateDocumentProcessingJobInput | CreateMaintenanceJobInput;

export interface CreateJobResult {
  created: boolean;
  job: Job;
}

export interface ListJobsInput {
  cursor?: JobCursor | undefined;
  documentId?: string | undefined;
  kind?: JobKind | undefined;
  limit: number;
  status?: JobStatus | undefined;
  userId: string;
}

export type JobPage = CursorPage<Job, JobCursor>;

export type CancellationResult = "already_terminal" | "cancelled" | "not_found" | "requested";

export interface ClaimJobInput {
  kinds?: readonly JobKind[] | undefined;
  leaseDurationMs: number;
  workerId: string;
}

export interface ClaimedJob {
  attempt: JobAttempt;
  job: Job & {
    claimedBy: string;
    claimToken: string;
    leaseExpiresAt: Date;
    status: "running";
  };
}

export interface ActiveJobState {
  cancellationRequestedAt: Date | null;
  leaseExpiresAt: Date;
}

export interface RenewJobLeaseInput {
  claimToken: string;
  jobId: string;
  leaseDurationMs: number;
}

export interface ReportJobProgressInput {
  claimToken: string;
  completed: number;
  currentStage?: DocumentProcessingStage | undefined;
  jobId: string;
  total: number;
}

interface FinishJobAttemptInputBase {
  claimToken: string;
  jobId: string;
}

export interface FinishSucceededJobAttemptInput extends FinishJobAttemptInputBase {
  outcome: "succeeded";
}

export interface FinishCancelledJobAttemptInput extends FinishJobAttemptInputBase {
  outcome: "cancelled";
}

interface FinishFailedJobAttemptInputBase extends FinishJobAttemptInputBase {
  errorCode: string;
  errorDetails?: JobErrorDetails | undefined;
  errorMessage?: string | null | undefined;
}

export interface FinishRetryableJobAttemptInput extends FinishFailedJobAttemptInputBase {
  availableAt: Date;
  outcome: "retryable_failure";
}

export interface FinishTerminalJobAttemptInput extends FinishFailedJobAttemptInputBase {
  outcome: "terminal_failure";
}

export type FinishJobAttemptInput =
  | FinishSucceededJobAttemptInput
  | FinishCancelledJobAttemptInput
  | FinishRetryableJobAttemptInput
  | FinishTerminalJobAttemptInput;

export interface RecoverExpiredJobsInput {
  limit: number;
}

export interface RecoverExpiredJobsResult {
  cancelled: number;
  failed: number;
  requeued: number;
}

export interface JobRepository {
  claimNext: (input: ClaimJobInput) => Promise<ClaimedJob | null>;
  create: (userId: string, input: CreateJobInput) => Promise<CreateJobResult>;
  findActiveDocumentJob: (userId: string, documentId: string) => Promise<Job | null>;
  findById: (userId: string, jobId: string) => Promise<Job | null>;
  findByIdempotencyKey: (userId: string, idempotencyKey: string) => Promise<Job | null>;
  finishAttempt: (input: FinishJobAttemptInput) => Promise<boolean>;
  list: (input: ListJobsInput) => Promise<JobPage>;
  listAttempts: (userId: string, jobId: string) => Promise<JobAttempt[]>;
  recoverExpired: (input: RecoverExpiredJobsInput) => Promise<RecoverExpiredJobsResult>;
  renewLease: (input: RenewJobLeaseInput) => Promise<ActiveJobState | null>;
  reportProgress: (input: ReportJobProgressInput) => Promise<ActiveJobState | null>;
  requestCancellation: (userId: string, jobId: string) => Promise<CancellationResult>;
}

export function createJobRepository(db: JobRepositoryExecutor): JobRepository {
  async function findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<Job | null> {
    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, userId), eq(jobs.idempotencyKey, idempotencyKey)))
      .limit(1);

    return job ?? null;
  }

  async function findActiveDocumentJob(userId: string, documentId: string): Promise<Job | null> {
    const [job] = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.userId, userId),
          eq(jobs.documentId, documentId),
          eq(jobs.kind, "document_processing"),
          inArray(jobs.status, ["queued", "running"]),
        ),
      )
      .limit(1);

    return job ?? null;
  }

  return {
    async claimNext(input) {
      validateLeaseDuration(input.leaseDurationMs);
      if (input.workerId.trim().length === 0) {
        throw new RangeError("Worker ID must not be blank");
      }
      if (input.kinds?.length === 0) return null;

      return db.transaction(async (tx) => {
        const [candidate] = await tx
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.status, "queued"),
              lte(jobs.availableAt, sql`now()`),
              lt(jobs.attemptCount, jobs.maxAttempts),
              input.kinds === undefined ? undefined : inArray(jobs.kind, [...input.kinds]),
            ),
          )
          .orderBy(asc(jobs.availableAt), asc(jobs.createdAt), asc(jobs.id))
          .limit(1)
          .for("update", { skipLocked: true });

        if (!candidate) return null;

        const claimToken = randomUUID();
        const [claimed] = await tx
          .update(jobs)
          .set({
            attemptCount: candidate.attemptCount + 1,
            claimedBy: input.workerId,
            claimToken,
            leaseExpiresAt: leaseExpiration(input.leaseDurationMs),
            status: "running",
            updatedAt: sql`now()`,
          })
          .where(and(eq(jobs.id, candidate.id), eq(jobs.status, "queued")))
          .returning();

        if (!claimed) {
          throw new Error("Locked job could not be claimed");
        }
        if (
          claimed.status !== "running" ||
          claimed.claimedBy === null ||
          claimed.claimToken === null ||
          claimed.leaseExpiresAt === null
        ) {
          throw new Error("Claimed job did not satisfy running-job invariants");
        }

        const [attempt] = await tx
          .insert(jobAttempts)
          .values({
            attemptNumber: claimed.attemptCount,
            claimToken,
            jobId: claimed.id,
            lastHeartbeatAt: sql`now()`,
            startedAt: sql`now()`,
            workerId: input.workerId,
          })
          .returning();

        if (!attempt) {
          throw new Error("Job attempt insert did not return a row");
        }

        return {
          attempt,
          job: {
            ...claimed,
            claimedBy: claimed.claimedBy,
            claimToken: claimed.claimToken,
            leaseExpiresAt: claimed.leaseExpiresAt,
            status: claimed.status,
          },
        };
      });
    },

    async create(userId, input) {
      const [created] = await db
        .insert(jobs)
        .values({
          availableAt: input.availableAt,
          configuration: input.configuration,
          configurationSchemaVersion: input.configurationSchemaVersion,
          currentStage: input.kind === "document_processing" ? input.startStage : null,
          documentId: input.documentId,
          idempotencyKey: input.idempotencyKey,
          kind: input.kind,
          maxAttempts: input.maxAttempts,
          startStage: input.kind === "document_processing" ? input.startStage : null,
          userId,
        })
        .onConflictDoNothing()
        .returning();

      if (created) return { created: true, job: created };

      const existing = await findByIdempotencyKey(userId, input.idempotencyKey);
      if (existing) return { created: false, job: existing };

      if (input.kind === "document_processing") {
        const active = await findActiveDocumentJob(userId, input.documentId);
        if (active) return { created: false, job: active };
      }

      throw new Error("Job insert conflicted but no existing job could be found");
    },

    findActiveDocumentJob,

    async findById(userId, jobId) {
      const [job] = await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.userId, userId), eq(jobs.id, jobId)))
        .limit(1);

      return job ?? null;
    },

    findByIdempotencyKey,

    async finishAttempt(input) {
      return db.transaction(async (tx) => {
        const [active] = await tx
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.id, input.jobId),
              eq(jobs.status, "running"),
              eq(jobs.claimToken, input.claimToken),
            ),
          )
          .limit(1)
          .for("update");

        if (!active) {
          const [finished] = await tx
            .select({ outcome: jobAttempts.outcome })
            .from(jobAttempts)
            .where(
              and(eq(jobAttempts.jobId, input.jobId), eq(jobAttempts.claimToken, input.claimToken)),
            )
            .limit(1);

          return (
            finished?.outcome === input.outcome ||
            (finished?.outcome === "cancelled" && input.outcome !== "succeeded")
          );
        }

        const cancellationWins =
          active.cancellationRequestedAt !== null && input.outcome !== "succeeded";
        const attemptOutcome = cancellationWins ? "cancelled" : input.outcome;
        const error =
          "errorCode" in input
            ? {
                errorCode: input.errorCode,
                errorDetails: input.errorDetails ?? {},
                errorMessage: input.errorMessage,
              }
            : { errorCode: null, errorDetails: {}, errorMessage: null };

        await tx
          .update(jobAttempts)
          .set({
            ...error,
            finishedAt: sql`now()`,
            lastHeartbeatAt: sql`now()`,
            outcome: attemptOutcome,
          })
          .where(
            and(
              eq(jobAttempts.jobId, active.id),
              eq(jobAttempts.claimToken, input.claimToken),
              sql`${jobAttempts.outcome} is null`,
            ),
          );

        const shouldRetry =
          input.outcome === "retryable_failure" &&
          !cancellationWins &&
          active.attemptCount < active.maxAttempts;
        const status: JobStatus = cancellationWins
          ? "cancelled"
          : shouldRetry
            ? "queued"
            : input.outcome === "succeeded"
              ? "succeeded"
              : input.outcome === "cancelled"
                ? "cancelled"
                : "failed";
        const terminal = status !== "queued";

        const [updated] = await tx
          .update(jobs)
          .set({
            availableAt: shouldRetry ? input.availableAt : active.availableAt,
            cancellationRequestedAt:
              status === "cancelled"
                ? (active.cancellationRequestedAt ?? sql`now()`)
                : active.cancellationRequestedAt,
            claimedBy: null,
            claimToken: null,
            finishedAt: terminal ? sql`now()` : null,
            lastErrorCode: "errorCode" in input ? input.errorCode : null,
            lastErrorMessage: "errorCode" in input ? input.errorMessage : null,
            leaseExpiresAt: null,
            status,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(jobs.id, active.id),
              eq(jobs.status, "running"),
              eq(jobs.claimToken, input.claimToken),
            ),
          )
          .returning({ id: jobs.id });

        return updated !== undefined;
      });
    },

    async list(input) {
      const cursorCondition = input.cursor
        ? or(
            lt(jobs.createdAt, input.cursor.createdAt),
            and(eq(jobs.createdAt, input.cursor.createdAt), lt(jobs.id, input.cursor.id)),
          )
        : undefined;
      const rows = await db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, input.userId),
            input.documentId === undefined ? undefined : eq(jobs.documentId, input.documentId),
            input.kind === undefined ? undefined : eq(jobs.kind, input.kind),
            input.status === undefined ? undefined : eq(jobs.status, input.status),
            cursorCondition,
          ),
        )
        .orderBy(desc(jobs.createdAt), desc(jobs.id))
        .limit(input.limit + 1);

      return createCursorPage(rows, input.limit, ({ createdAt, id }) => ({ createdAt, id }));
    },

    async listAttempts(userId, jobId) {
      return db
        .select({ attempt: jobAttempts })
        .from(jobAttempts)
        .innerJoin(jobs, eq(jobs.id, jobAttempts.jobId))
        .where(and(eq(jobs.userId, userId), eq(jobs.id, jobId)))
        .orderBy(asc(jobAttempts.attemptNumber))
        .then((rows) => rows.map(({ attempt }) => attempt));
    },

    async recoverExpired(input) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
        throw new RangeError("Recovery limit must be a positive safe integer");
      }

      return db.transaction(async (tx) => {
        const expired = await tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.status, "running"), lte(jobs.leaseExpiresAt, sql`now()`)))
          .orderBy(asc(jobs.leaseExpiresAt), asc(jobs.id))
          .limit(input.limit)
          .for("update", { skipLocked: true });
        const recovered = await Promise.all(
          expired.map(async (job): Promise<"cancelled" | "failed" | "queued" | null> => {
            if (!job.claimToken) return null;

            await tx
              .update(jobAttempts)
              .set({ finishedAt: sql`now()`, outcome: "lease_expired" })
              .where(
                and(
                  eq(jobAttempts.jobId, job.id),
                  eq(jobAttempts.claimToken, job.claimToken),
                  sql`${jobAttempts.outcome} is null`,
                ),
              );

            const status: JobStatus =
              job.cancellationRequestedAt !== null
                ? "cancelled"
                : job.attemptCount >= job.maxAttempts
                  ? "failed"
                  : "queued";

            await tx
              .update(jobs)
              .set({
                availableAt: status === "queued" ? sql`now()` : job.availableAt,
                claimedBy: null,
                claimToken: null,
                finishedAt: status === "queued" ? null : sql`now()`,
                lastErrorCode: status === "failed" ? "job_lease_expired" : job.lastErrorCode,
                lastErrorMessage:
                  status === "failed"
                    ? "The job exhausted its attempts after a lease expired"
                    : job.lastErrorMessage,
                leaseExpiresAt: null,
                status,
                updatedAt: sql`now()`,
              })
              .where(and(eq(jobs.id, job.id), eq(jobs.claimToken, job.claimToken)));

            return status;
          }),
        );

        return recovered.reduce<RecoverExpiredJobsResult>(
          (result, status) => {
            if (status !== null) result[status === "queued" ? "requeued" : status] += 1;
            return result;
          },
          { cancelled: 0, failed: 0, requeued: 0 },
        );
      });
    },

    async renewLease(input) {
      validateLeaseDuration(input.leaseDurationMs);
      const [updated] = await db
        .update(jobs)
        .set({ leaseExpiresAt: leaseExpiration(input.leaseDurationMs), updatedAt: sql`now()` })
        .where(
          and(
            eq(jobs.id, input.jobId),
            eq(jobs.status, "running"),
            eq(jobs.claimToken, input.claimToken),
            sql`${jobs.leaseExpiresAt} > now()`,
          ),
        )
        .returning({
          cancellationRequestedAt: jobs.cancellationRequestedAt,
          leaseExpiresAt: jobs.leaseExpiresAt,
        });

      if (!updated || updated.leaseExpiresAt === null) return null;
      return {
        cancellationRequestedAt: updated.cancellationRequestedAt,
        leaseExpiresAt: updated.leaseExpiresAt,
      };
    },

    async reportProgress(input) {
      validateProgress(input.completed, input.total);
      const [updated] = await db
        .update(jobs)
        .set({
          ...(input.currentStage === undefined ? {} : { currentStage: input.currentStage }),
          progressCompleted: input.completed,
          progressTotal: input.total,
          progressUpdatedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(jobs.id, input.jobId),
            eq(jobs.status, "running"),
            eq(jobs.claimToken, input.claimToken),
            sql`${jobs.leaseExpiresAt} > now()`,
          ),
        )
        .returning({
          cancellationRequestedAt: jobs.cancellationRequestedAt,
          leaseExpiresAt: jobs.leaseExpiresAt,
        });

      if (!updated || updated.leaseExpiresAt === null) return null;
      return {
        cancellationRequestedAt: updated.cancellationRequestedAt,
        leaseExpiresAt: updated.leaseExpiresAt,
      };
    },

    async requestCancellation(userId, jobId) {
      return db.transaction(async (tx) => {
        const [job] = await tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.userId, userId), eq(jobs.id, jobId)))
          .limit(1)
          .for("update");

        if (!job) return "not_found";
        if (job.status === "cancelled") return "cancelled";
        if (job.status === "succeeded" || job.status === "failed") return "already_terminal";

        if (job.status === "queued") {
          await tx
            .update(jobs)
            .set({
              cancellationRequestedAt: sql`now()`,
              finishedAt: sql`now()`,
              status: "cancelled",
              updatedAt: sql`now()`,
            })
            .where(and(eq(jobs.id, job.id), eq(jobs.status, "queued")));
          return "cancelled";
        }

        await tx
          .update(jobs)
          .set({
            cancellationRequestedAt: job.cancellationRequestedAt ?? sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(and(eq(jobs.id, job.id), eq(jobs.status, "running")));
        return "requested";
      });
    },
  };
}

function leaseExpiration(durationMs: number) {
  return sql<Date>`now() + (${durationMs} * interval '1 millisecond')`;
}

function validateLeaseDuration(durationMs: number): void {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1) {
    throw new RangeError("Lease duration must be a positive safe integer of milliseconds");
  }
}

function validateProgress(completed: number, total: number): void {
  if (
    !Number.isSafeInteger(completed) ||
    !Number.isSafeInteger(total) ||
    completed < 0 ||
    total < 1 ||
    completed > total
  ) {
    throw new RangeError("Job progress must satisfy 0 <= completed <= total");
  }
}
