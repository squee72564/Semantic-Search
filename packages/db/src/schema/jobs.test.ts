import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  documentProcessingStage,
  jobAttempts,
  jobAttemptOutcome,
  jobKind,
  jobs,
  jobStatus,
} from "./jobs.js";

describe("Jobs schema", () => {
  it("defines durable job identity, scheduling, progress, and lease state", () => {
    const columns = getTableColumns(jobs);

    expect(Object.keys(columns)).toEqual([
      "id",
      "kind",
      "userId",
      "documentId",
      "status",
      "idempotencyKey",
      "startStage",
      "currentStage",
      "configurationSchemaVersion",
      "configuration",
      "attemptCount",
      "maxAttempts",
      "availableAt",
      "progressCompleted",
      "progressTotal",
      "progressUpdatedAt",
      "cancellationRequestedAt",
      "claimedBy",
      "claimToken",
      "leaseExpiresAt",
      "lastErrorCode",
      "lastErrorMessage",
      "finishedAt",
      "createdAt",
      "updatedAt",
    ]);
    expect(columns.id.primary).toBe(true);
    expect(columns.id.hasDefault).toBe(true);
    expect(columns.documentId.notNull).toBe(false);
    expect(columns.status.hasDefault).toBe(true);
    expect(columns.configuration.hasDefault).toBe(true);
    expect(columns.attemptCount.hasDefault).toBe(true);
    expect(columns.availableAt.hasDefault).toBe(true);

    expect(jobKind.enumValues).toEqual([
      "document_processing",
      "document_garbage_collection",
      "storage_reconciliation",
    ]);
    expect(jobStatus.enumValues).toEqual(["queued", "running", "succeeded", "failed", "cancelled"]);
    expect(documentProcessingStage.enumValues).toEqual([
      "preflight",
      "ocr",
      "extraction",
      "chunking",
      "embedding",
      "finalizing",
    ]);
  });

  it("defines ownership, state-machine, idempotency, and worker indexes", () => {
    const config = getTableConfig(jobs);

    expect(config.foreignKeys).toHaveLength(2);
    expect(config.foreignKeys.map((constraint) => constraint.getName())).toEqual([
      "jobs_user_id_user_id_fk",
      "jobs_user_document_fk",
    ]);
    expect(config.foreignKeys.every((constraint) => constraint.onDelete === "cascade")).toBe(true);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toEqual([
      "jobs_user_idempotency_key_unique",
    ]);
    expect(config.checks.map((constraint) => constraint.name)).toEqual([
      "jobs_idempotency_key_not_blank",
      "jobs_configuration_schema_version_positive",
      "jobs_configuration_object",
      "jobs_attempts_valid",
      "jobs_progress_valid",
      "jobs_processing_scope_valid",
      "jobs_claim_valid",
      "jobs_finished_at_valid",
      "jobs_cancelled_request_present",
    ]);
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      "jobs_document_processing_active_unique",
      "jobs_claim_idx",
      "jobs_lease_recovery_idx",
      "jobs_user_status_created_idx",
      "jobs_document_created_idx",
    ]);
    expect(config.indexes[0]?.config.unique).toBe(true);
    expect(config.indexes[0]?.config.where).toBeDefined();
    expect(config.indexes[1]?.config.where).toBeDefined();
    expect(config.indexes[2]?.config.where).toBeDefined();
  });
});

describe("Job attempts schema", () => {
  it("defines append-oriented execution history", () => {
    const columns = getTableColumns(jobAttempts);

    expect(Object.keys(columns)).toEqual([
      "id",
      "jobId",
      "attemptNumber",
      "workerId",
      "claimToken",
      "startedAt",
      "lastHeartbeatAt",
      "finishedAt",
      "outcome",
      "errorCode",
      "errorMessage",
      "errorDetails",
    ]);
    expect(columns.id.primary).toBe(true);
    expect(columns.jobId.notNull).toBe(true);
    expect(columns.startedAt.hasDefault).toBe(true);
    expect(columns.lastHeartbeatAt.hasDefault).toBe(true);
    expect(columns.outcome.notNull).toBe(false);
    expect(columns.errorDetails.hasDefault).toBe(true);
    expect(jobAttemptOutcome.enumValues).toEqual([
      "succeeded",
      "retryable_failure",
      "terminal_failure",
      "cancelled",
      "lease_expired",
    ]);
  });

  it("defines attempt sequencing, fencing, outcomes, and history lookup", () => {
    const config = getTableConfig(jobAttempts);

    expect(config.foreignKeys).toHaveLength(1);
    expect(config.foreignKeys[0]?.onDelete).toBe("cascade");
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toEqual([
      "job_attempts_job_attempt_number_unique",
      "job_attempts_claim_token_unique",
    ]);
    expect(config.checks.map((constraint) => constraint.name)).toEqual([
      "job_attempts_attempt_number_positive",
      "job_attempts_worker_id_not_blank",
      "job_attempts_error_details_object",
      "job_attempts_completion_valid",
      "job_attempts_failure_error_present",
      "job_attempts_success_error_absent",
    ]);
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      "job_attempts_job_attempt_number_idx",
    ]);
  });
});
