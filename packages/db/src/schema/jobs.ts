import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { user } from "./auth.js";
import { documents } from "./documents.js";

export const jobKind = pgEnum("job_kind", [
  "document_processing",
  "document_garbage_collection",
  "storage_reconciliation",
]);

export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const documentProcessingStage = pgEnum("document_processing_stage", [
  "preflight",
  "ocr",
  "extraction",
  "chunking",
  "embedding",
  "finalizing",
]);

export const jobAttemptOutcome = pgEnum("job_attempt_outcome", [
  "succeeded",
  "retryable_failure",
  "terminal_failure",
  "cancelled",
  "lease_expired",
]);

export type JobConfiguration = Record<string, unknown>;
export type JobErrorDetails = Record<string, unknown>;

export const jobs = pgTable(
  "jobs",
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: jobKind().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentId: uuid("document_id"),
    status: jobStatus().notNull().default("queued"),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    startStage: documentProcessingStage("start_stage"),
    currentStage: documentProcessingStage("current_stage"),
    configurationSchemaVersion: integer("configuration_schema_version").notNull(),
    configuration: jsonb().$type<JobConfiguration>().notNull().default({}),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    availableAt: timestamp("available_at", { precision: 3, withTimezone: true })
      .notNull()
      .defaultNow(),
    progressCompleted: integer("progress_completed"),
    progressTotal: integer("progress_total"),
    progressUpdatedAt: timestamp("progress_updated_at", { precision: 3, withTimezone: true }),
    cancellationRequestedAt: timestamp("cancellation_requested_at", {
      precision: 3,
      withTimezone: true,
    }),
    claimedBy: varchar("claimed_by", { length: 255 }),
    claimToken: uuid("claim_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { precision: 3, withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    lastErrorMessage: text("last_error_message"),
    finishedAt: timestamp("finished_at", { precision: 3, withTimezone: true }),
    createdAt: timestamp("created_at", { precision: 3, withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "jobs_user_document_fk",
      columns: [table.userId, table.documentId],
      foreignColumns: [documents.userId, documents.id],
    }).onDelete("cascade"),
    unique("jobs_user_idempotency_key_unique").on(table.userId, table.idempotencyKey),
    check("jobs_idempotency_key_not_blank", sql`btrim(${table.idempotencyKey}) <> ''`),
    check(
      "jobs_configuration_schema_version_positive",
      sql`${table.configurationSchemaVersion} > 0`,
    ),
    check("jobs_configuration_object", sql`jsonb_typeof(${table.configuration}) = 'object'`),
    check(
      "jobs_attempts_valid",
      sql`${table.attemptCount} >= 0 AND ${table.maxAttempts} > 0 AND ${table.attemptCount} <= ${table.maxAttempts}`,
    ),
    check(
      "jobs_progress_valid",
      sql`(
        ${table.progressCompleted} IS NULL
        AND ${table.progressTotal} IS NULL
        AND ${table.progressUpdatedAt} IS NULL
      ) OR (
        ${table.progressCompleted} >= 0
        AND ${table.progressTotal} > 0
        AND ${table.progressCompleted} <= ${table.progressTotal}
        AND ${table.progressUpdatedAt} IS NOT NULL
      )`,
    ),
    check(
      "jobs_processing_scope_valid",
      sql`(
        ${table.kind} = 'document_processing'
        AND ${table.documentId} IS NOT NULL
        AND ${table.startStage} IS NOT NULL
        AND ${table.currentStage} IS NOT NULL
      ) OR (
        ${table.kind} <> 'document_processing'
        AND ${table.startStage} IS NULL
        AND ${table.currentStage} IS NULL
      )`,
    ),
    check(
      "jobs_claim_valid",
      sql`(
        ${table.status} = 'running'
        AND ${table.claimedBy} IS NOT NULL
        AND btrim(${table.claimedBy}) <> ''
        AND ${table.claimToken} IS NOT NULL
        AND ${table.leaseExpiresAt} IS NOT NULL
      ) OR (
        ${table.status} <> 'running'
        AND ${table.claimedBy} IS NULL
        AND ${table.claimToken} IS NULL
        AND ${table.leaseExpiresAt} IS NULL
      )`,
    ),
    check(
      "jobs_finished_at_valid",
      sql`(
        ${table.status} IN ('succeeded', 'failed', 'cancelled')
        AND ${table.finishedAt} IS NOT NULL
      ) OR (
        ${table.status} IN ('queued', 'running')
        AND ${table.finishedAt} IS NULL
      )`,
    ),
    check(
      "jobs_cancelled_request_present",
      sql`${table.status} <> 'cancelled' OR ${table.cancellationRequestedAt} IS NOT NULL`,
    ),
    uniqueIndex("jobs_document_processing_active_unique")
      .on(table.documentId)
      .where(
        sql`${table.kind} = 'document_processing' AND ${table.status} IN ('queued', 'running')`,
      ),
    index("jobs_claim_idx")
      .on(table.availableAt, table.createdAt, table.id)
      .where(sql`${table.status} = 'queued'`),
    index("jobs_lease_recovery_idx")
      .on(table.leaseExpiresAt, table.id)
      .where(sql`${table.status} = 'running'`),
    index("jobs_user_status_created_idx").on(
      table.userId,
      table.status,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("jobs_document_created_idx").on(
      table.documentId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const jobAttempts = pgTable(
  "job_attempts",
  {
    id: uuid().primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    workerId: varchar("worker_id", { length: 255 }).notNull(),
    claimToken: uuid("claim_token").notNull(),
    startedAt: timestamp("started_at", { precision: 3, withTimezone: true }).notNull().defaultNow(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { precision: 3, withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { precision: 3, withTimezone: true }),
    outcome: jobAttemptOutcome(),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: text("error_message"),
    errorDetails: jsonb("error_details").$type<JobErrorDetails>().notNull().default({}),
  },
  (table) => [
    unique("job_attempts_job_attempt_number_unique").on(table.jobId, table.attemptNumber),
    unique("job_attempts_claim_token_unique").on(table.claimToken),
    check("job_attempts_attempt_number_positive", sql`${table.attemptNumber} > 0`),
    check("job_attempts_worker_id_not_blank", sql`btrim(${table.workerId}) <> ''`),
    check("job_attempts_error_details_object", sql`jsonb_typeof(${table.errorDetails}) = 'object'`),
    check(
      "job_attempts_completion_valid",
      sql`(${table.outcome} IS NULL AND ${table.finishedAt} IS NULL) OR (${table.outcome} IS NOT NULL AND ${table.finishedAt} IS NOT NULL)`,
    ),
    check(
      "job_attempts_failure_error_present",
      sql`${table.outcome} NOT IN ('retryable_failure', 'terminal_failure') OR ${table.errorCode} IS NOT NULL`,
    ),
    check(
      "job_attempts_success_error_absent",
      sql`${table.outcome} <> 'succeeded' OR (${table.errorCode} IS NULL AND ${table.errorMessage} IS NULL AND ${table.errorDetails} = '{}'::jsonb)`,
    ),
    index("job_attempts_job_attempt_number_idx").on(table.jobId, table.attemptNumber.desc()),
  ],
);

export const jobsRelations = relations(jobs, ({ many, one }) => ({
  attempts: many(jobAttempts),
  document: one(documents, {
    fields: [jobs.userId, jobs.documentId],
    references: [documents.userId, documents.id],
  }),
  user: one(user, {
    fields: [jobs.userId],
    references: [user.id],
  }),
}));

export const jobAttemptsRelations = relations(jobAttempts, ({ one }) => ({
  job: one(jobs, {
    fields: [jobAttempts.jobId],
    references: [jobs.id],
  }),
}));

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobKind = (typeof jobKind.enumValues)[number];
export type JobStatus = (typeof jobStatus.enumValues)[number];
export type DocumentProcessingStage = (typeof documentProcessingStage.enumValues)[number];
export type JobAttempt = typeof jobAttempts.$inferSelect;
export type NewJobAttempt = typeof jobAttempts.$inferInsert;
export type JobAttemptOutcome = (typeof jobAttemptOutcome.enumValues)[number];
