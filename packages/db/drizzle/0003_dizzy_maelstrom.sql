CREATE TYPE "public"."document_processing_stage" AS ENUM('preflight', 'ocr', 'extraction', 'chunking', 'embedding', 'finalizing');--> statement-breakpoint
CREATE TYPE "public"."job_attempt_outcome" AS ENUM('succeeded', 'retryable_failure', 'terminal_failure', 'cancelled', 'lease_expired');--> statement-breakpoint
CREATE TYPE "public"."job_kind" AS ENUM('document_processing', 'document_garbage_collection', 'storage_reconciliation');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "job_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"worker_id" varchar(255) NOT NULL,
	"claim_token" uuid NOT NULL,
	"started_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp (3) with time zone,
	"outcome" "job_attempt_outcome",
	"error_code" varchar(100),
	"error_message" text,
	"error_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "job_attempts_job_attempt_number_unique" UNIQUE("job_id","attempt_number"),
	CONSTRAINT "job_attempts_claim_token_unique" UNIQUE("claim_token"),
	CONSTRAINT "job_attempts_attempt_number_positive" CHECK ("job_attempts"."attempt_number" > 0),
	CONSTRAINT "job_attempts_worker_id_not_blank" CHECK (btrim("job_attempts"."worker_id") <> ''),
	CONSTRAINT "job_attempts_error_details_object" CHECK (jsonb_typeof("job_attempts"."error_details") = 'object'),
	CONSTRAINT "job_attempts_completion_valid" CHECK (("job_attempts"."outcome" IS NULL AND "job_attempts"."finished_at" IS NULL) OR ("job_attempts"."outcome" IS NOT NULL AND "job_attempts"."finished_at" IS NOT NULL)),
	CONSTRAINT "job_attempts_failure_error_present" CHECK ("job_attempts"."outcome" NOT IN ('retryable_failure', 'terminal_failure') OR "job_attempts"."error_code" IS NOT NULL),
	CONSTRAINT "job_attempts_success_error_absent" CHECK ("job_attempts"."outcome" <> 'succeeded' OR ("job_attempts"."error_code" IS NULL AND "job_attempts"."error_message" IS NULL AND "job_attempts"."error_details" = '{}'::jsonb))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "job_kind" NOT NULL,
	"user_id" text NOT NULL,
	"document_id" uuid,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"start_stage" "document_processing_stage",
	"current_stage" "document_processing_stage",
	"configuration_schema_version" integer NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"available_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"progress_completed" integer,
	"progress_total" integer,
	"progress_updated_at" timestamp (3) with time zone,
	"cancellation_requested_at" timestamp (3) with time zone,
	"claimed_by" varchar(255),
	"claim_token" uuid,
	"lease_expires_at" timestamp (3) with time zone,
	"last_error_code" varchar(100),
	"last_error_message" text,
	"finished_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_user_idempotency_key_unique" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "jobs_idempotency_key_not_blank" CHECK (btrim("jobs"."idempotency_key") <> ''),
	CONSTRAINT "jobs_configuration_schema_version_positive" CHECK ("jobs"."configuration_schema_version" > 0),
	CONSTRAINT "jobs_configuration_object" CHECK (jsonb_typeof("jobs"."configuration") = 'object'),
	CONSTRAINT "jobs_attempts_valid" CHECK ("jobs"."attempt_count" >= 0 AND "jobs"."max_attempts" > 0 AND "jobs"."attempt_count" <= "jobs"."max_attempts"),
	CONSTRAINT "jobs_progress_valid" CHECK ((
        "jobs"."progress_completed" IS NULL
        AND "jobs"."progress_total" IS NULL
        AND "jobs"."progress_updated_at" IS NULL
      ) OR (
        "jobs"."progress_completed" >= 0
        AND "jobs"."progress_total" > 0
        AND "jobs"."progress_completed" <= "jobs"."progress_total"
        AND "jobs"."progress_updated_at" IS NOT NULL
      )),
	CONSTRAINT "jobs_processing_scope_valid" CHECK ((
        "jobs"."kind" = 'document_processing'
        AND "jobs"."document_id" IS NOT NULL
        AND "jobs"."start_stage" IS NOT NULL
        AND "jobs"."current_stage" IS NOT NULL
      ) OR (
        "jobs"."kind" <> 'document_processing'
        AND "jobs"."start_stage" IS NULL
        AND "jobs"."current_stage" IS NULL
      )),
	CONSTRAINT "jobs_claim_valid" CHECK ((
        "jobs"."status" = 'running'
        AND "jobs"."claimed_by" IS NOT NULL
        AND btrim("jobs"."claimed_by") <> ''
        AND "jobs"."claim_token" IS NOT NULL
        AND "jobs"."lease_expires_at" IS NOT NULL
      ) OR (
        "jobs"."status" <> 'running'
        AND "jobs"."claimed_by" IS NULL
        AND "jobs"."claim_token" IS NULL
        AND "jobs"."lease_expires_at" IS NULL
      )),
	CONSTRAINT "jobs_finished_at_valid" CHECK ((
        "jobs"."status" IN ('succeeded', 'failed', 'cancelled')
        AND "jobs"."finished_at" IS NOT NULL
      ) OR (
        "jobs"."status" IN ('queued', 'running')
        AND "jobs"."finished_at" IS NULL
      )),
	CONSTRAINT "jobs_cancelled_request_present" CHECK ("jobs"."status" <> 'cancelled' OR "jobs"."cancellation_requested_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "job_attempts" ADD CONSTRAINT "job_attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_document_fk" FOREIGN KEY ("user_id","document_id") REFERENCES "public"."documents"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_attempts_job_attempt_number_idx" ON "job_attempts" USING btree ("job_id","attempt_number" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_document_processing_active_unique" ON "jobs" USING btree ("document_id") WHERE "jobs"."kind" = 'document_processing' AND "jobs"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("available_at","created_at","id") WHERE "jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "jobs_lease_recovery_idx" ON "jobs" USING btree ("lease_expires_at","id") WHERE "jobs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "jobs_user_status_created_idx" ON "jobs" USING btree ("user_id","status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_document_created_idx" ON "jobs" USING btree ("document_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);