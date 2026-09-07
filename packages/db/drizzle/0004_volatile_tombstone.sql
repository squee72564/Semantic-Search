CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('pending', 'complete', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."retrieval_run_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" varchar(255),
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "conversations_user_workspace_id_id_unique" UNIQUE("user_id","workspace_id","id"),
	CONSTRAINT "conversations_title_not_blank" CHECK ("conversations"."title" IS NULL OR btrim("conversations"."title") <> '')
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"retrieval_run_id" uuid,
	"sequence" integer NOT NULL,
	"role" "message_role" NOT NULL,
	"status" "message_status" DEFAULT 'complete' NOT NULL,
	"content_schema_version" integer DEFAULT 1 NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_conversation_sequence_unique" UNIQUE("conversation_id","sequence"),
	CONSTRAINT "messages_retrieval_run_id_unique" UNIQUE("retrieval_run_id"),
	CONSTRAINT "messages_sequence_positive" CHECK ("messages"."sequence" > 0),
	CONSTRAINT "messages_content_schema_version_positive" CHECK ("messages"."content_schema_version" > 0),
	CONSTRAINT "messages_parts_array" CHECK (jsonb_typeof("messages"."parts") = 'array'),
	CONSTRAINT "messages_complete_parts_present" CHECK ("messages"."status" <> 'complete' OR jsonb_array_length("messages"."parts") > 0),
	CONSTRAINT "messages_error_details_object" CHECK (jsonb_typeof("messages"."error_details") = 'object'),
	CONSTRAINT "messages_error_valid" CHECK ((
        "messages"."status" = 'failed'
        AND "messages"."error_details" <> '{}'::jsonb
      ) OR (
        "messages"."status" <> 'failed'
        AND "messages"."error_details" = '{}'::jsonb
      )),
	CONSTRAINT "messages_role_retrieval_run_valid" CHECK ((
        "messages"."role" = 'user'
        AND "messages"."status" = 'complete'
        AND "messages"."retrieval_run_id" IS NULL
      ) OR (
        "messages"."role" = 'assistant'
        AND "messages"."retrieval_run_id" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "retrieval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" "retrieval_run_status" DEFAULT 'pending' NOT NULL,
	"original_question" text NOT NULL,
	"eligible_document_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"query_plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trace" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retrieval_runs_user_conversation_id_unique" UNIQUE("user_id","conversation_id","id"),
	CONSTRAINT "retrieval_runs_original_question_not_blank" CHECK (btrim("retrieval_runs"."original_question") <> ''),
	CONSTRAINT "retrieval_runs_schema_version_positive" CHECK ("retrieval_runs"."schema_version" > 0),
	CONSTRAINT "retrieval_runs_eligible_document_ids_not_null" CHECK (array_position("retrieval_runs"."eligible_document_ids", NULL) IS NULL),
	CONSTRAINT "retrieval_runs_query_plan_object" CHECK (jsonb_typeof("retrieval_runs"."query_plan") = 'object'),
	CONSTRAINT "retrieval_runs_trace_object" CHECK (jsonb_typeof("retrieval_runs"."trace") = 'object'),
	CONSTRAINT "retrieval_runs_model_configuration_object" CHECK (jsonb_typeof("retrieval_runs"."model_configuration") = 'object'),
	CONSTRAINT "retrieval_runs_result_object" CHECK (jsonb_typeof("retrieval_runs"."result") = 'object'),
	CONSTRAINT "retrieval_runs_error_details_object" CHECK (jsonb_typeof("retrieval_runs"."error_details") = 'object'),
	CONSTRAINT "retrieval_runs_completion_valid" CHECK ((
        "retrieval_runs"."status" IN ('succeeded', 'failed', 'cancelled')
        AND "retrieval_runs"."completed_at" IS NOT NULL
      ) OR (
        "retrieval_runs"."status" IN ('pending', 'running')
        AND "retrieval_runs"."completed_at" IS NULL
      )),
	CONSTRAINT "retrieval_runs_error_valid" CHECK ((
        "retrieval_runs"."status" = 'failed'
        AND "retrieval_runs"."error_details" <> '{}'::jsonb
      ) OR (
        "retrieval_runs"."status" <> 'failed'
        AND "retrieval_runs"."error_details" = '{}'::jsonb
      )),
	CONSTRAINT "retrieval_runs_result_valid" CHECK ("retrieval_runs"."status" <> 'succeeded' OR "retrieval_runs"."result" <> '{}'::jsonb)
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_workspace_fk" FOREIGN KEY ("user_id","workspace_id") REFERENCES "public"."workspaces"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_conversation_fk" FOREIGN KEY ("user_id","conversation_id") REFERENCES "public"."conversations"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_conversation_retrieval_run_fk" FOREIGN KEY ("user_id","conversation_id","retrieval_run_id") REFERENCES "public"."retrieval_runs"("user_id","conversation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_runs" ADD CONSTRAINT "retrieval_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_runs" ADD CONSTRAINT "retrieval_runs_user_workspace_fk" FOREIGN KEY ("user_id","workspace_id") REFERENCES "public"."workspaces"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_runs" ADD CONSTRAINT "retrieval_runs_user_workspace_conversation_fk" FOREIGN KEY ("user_id","workspace_id","conversation_id") REFERENCES "public"."conversations"("user_id","workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_user_workspace_updated_idx" ON "conversations" USING btree ("user_id","workspace_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "retrieval_runs_user_workspace_status_created_idx" ON "retrieval_runs" USING btree ("user_id","workspace_id","status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "retrieval_runs_conversation_created_idx" ON "retrieval_runs" USING btree ("conversation_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
