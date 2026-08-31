-- Canonical PDF documents and workspace-specific attachments.
CREATE TYPE "public"."document_status" AS ENUM('uploaded', 'processing', 'ready', 'failed', 'deleting');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"title" varchar(255),
	"description" text,
	"custom_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"original_object_key" text NOT NULL,
	"original_size_bytes" bigint NOT NULL,
	"original_content_type" varchar(255) NOT NULL,
	"page_count" integer,
	"status" "document_status" DEFAULT 'uploaded' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_user_id_id_unique" UNIQUE("user_id","id"),
	CONSTRAINT "documents_user_sha256_unique" UNIQUE("user_id","sha256"),
	CONSTRAINT "documents_original_object_key_unique" UNIQUE("original_object_key"),
	CONSTRAINT "documents_sha256_format" CHECK ("documents"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "documents_original_filename_not_blank" CHECK (btrim("documents"."original_filename") <> ''),
	CONSTRAINT "documents_title_not_blank" CHECK ("documents"."title" IS NULL OR btrim("documents"."title") <> ''),
	CONSTRAINT "documents_custom_metadata_object" CHECK (jsonb_typeof("documents"."custom_metadata") = 'object'),
	CONSTRAINT "documents_original_object_key_not_blank" CHECK (btrim("documents"."original_object_key") <> ''),
	CONSTRAINT "documents_original_size_positive" CHECK ("documents"."original_size_bytes" > 0),
	CONSTRAINT "documents_page_count_positive" CHECK ("documents"."page_count" IS NULL OR "documents"."page_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_documents" (
	"user_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"display_title" varchar(255),
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"attached_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_documents_workspace_id_document_id_pk" PRIMARY KEY("workspace_id","document_id"),
	CONSTRAINT "workspace_documents_display_title_not_blank" CHECK ("workspace_documents"."display_title" IS NULL OR btrim("workspace_documents"."display_title") <> ''),
	CONSTRAINT "workspace_documents_tags_count" CHECK (cardinality("workspace_documents"."tags") <= 32),
	CONSTRAINT "workspace_documents_tags_not_null" CHECK (array_position("workspace_documents"."tags", NULL) IS NULL)
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_documents" ADD CONSTRAINT "workspace_documents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_documents" ADD CONSTRAINT "workspace_documents_user_workspace_fk" FOREIGN KEY ("user_id","workspace_id") REFERENCES "public"."workspaces"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_documents" ADD CONSTRAINT "workspace_documents_user_document_fk" FOREIGN KEY ("user_id","document_id") REFERENCES "public"."documents"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_user_created_idx" ON "documents" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "documents_user_updated_idx" ON "documents" USING btree ("user_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "documents_user_status_created_idx" ON "documents" USING btree ("user_id","status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "workspace_documents_user_workspace_attached_idx" ON "workspace_documents" USING btree ("user_id","workspace_id","attached_at" DESC NULLS LAST,"document_id");--> statement-breakpoint
CREATE INDEX "workspace_documents_user_document_idx" ON "workspace_documents" USING btree ("user_id","document_id");--> statement-breakpoint
CREATE INDEX "workspace_documents_tags_idx" ON "workspace_documents" USING gin ("tags");
