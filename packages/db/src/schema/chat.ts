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
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { user } from "./auth.js";
import { workspaces } from "./workspaces.js";

export const messageRole = pgEnum("message_role", ["user", "assistant"]);

export const messageStatus = pgEnum("message_status", [
  "pending",
  "complete",
  "failed",
  "cancelled",
]);

export const retrievalRunStatus = pgEnum("retrieval_run_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export interface TextMessagePart {
  type: "text";
  text: string;
}

export interface SourceMessagePart {
  type: "source";
  sourceId: string;
  documentId?: string;
  pageNumber?: number;
  title?: string;
}

export type MessagePart = SourceMessagePart | TextMessagePart;
export type RetrievalQueryPlan = Record<string, unknown>;
export type RetrievalTrace = Record<string, unknown>;
export type ModelConfiguration = Record<string, unknown>;
export type RetrievalRunResult = Record<string, unknown>;
export type RetrievalRunErrorDetails = Record<string, unknown>;
export type MessageErrorDetails = Record<string, unknown>;

export const conversations = pgTable(
  "conversations",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull(),
    title: varchar({ length: 255 }),
    createdAt: timestamp("created_at", { precision: 3, withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "conversations_user_workspace_fk",
      columns: [table.userId, table.workspaceId],
      foreignColumns: [workspaces.userId, workspaces.id],
    }).onDelete("cascade"),
    check(
      "conversations_title_not_blank",
      sql`${table.title} IS NULL OR btrim(${table.title}) <> ''`,
    ),
    unique("conversations_user_id_id_unique").on(table.userId, table.id),
    unique("conversations_user_workspace_id_id_unique").on(
      table.userId,
      table.workspaceId,
      table.id,
    ),
    index("conversations_user_workspace_updated_idx").on(
      table.userId,
      table.workspaceId,
      table.updatedAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const retrievalRuns = pgTable(
  "retrieval_runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    status: retrievalRunStatus().notNull().default("pending"),
    originalQuestion: text("original_question").notNull(),
    eligibleDocumentIds: uuid("eligible_document_ids")
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    schemaVersion: integer("schema_version").notNull().default(1),
    queryPlan: jsonb("query_plan").$type<RetrievalQueryPlan>().notNull().default({}),
    trace: jsonb().$type<RetrievalTrace>().notNull().default({}),
    modelConfiguration: jsonb("model_configuration")
      .$type<ModelConfiguration>()
      .notNull()
      .default({}),
    result: jsonb().$type<RetrievalRunResult>().notNull().default({}),
    errorDetails: jsonb("error_details")
      .$type<RetrievalRunErrorDetails>()
      .notNull()
      .default({}),
    completedAt: timestamp("completed_at", { precision: 3, withTimezone: true }),
    createdAt: timestamp("created_at", { precision: 3, withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "retrieval_runs_user_workspace_fk",
      columns: [table.userId, table.workspaceId],
      foreignColumns: [workspaces.userId, workspaces.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "retrieval_runs_user_workspace_conversation_fk",
      columns: [table.userId, table.workspaceId, table.conversationId],
      foreignColumns: [conversations.userId, conversations.workspaceId, conversations.id],
    }).onDelete("cascade"),
    check(
      "retrieval_runs_original_question_not_blank",
      sql`btrim(${table.originalQuestion}) <> ''`,
    ),
    check("retrieval_runs_schema_version_positive", sql`${table.schemaVersion} > 0`),
    check(
      "retrieval_runs_eligible_document_ids_not_null",
      sql`array_position(${table.eligibleDocumentIds}, NULL) IS NULL`,
    ),
    check("retrieval_runs_query_plan_object", sql`jsonb_typeof(${table.queryPlan}) = 'object'`),
    check("retrieval_runs_trace_object", sql`jsonb_typeof(${table.trace}) = 'object'`),
    check(
      "retrieval_runs_model_configuration_object",
      sql`jsonb_typeof(${table.modelConfiguration}) = 'object'`,
    ),
    check("retrieval_runs_result_object", sql`jsonb_typeof(${table.result}) = 'object'`),
    check(
      "retrieval_runs_error_details_object",
      sql`jsonb_typeof(${table.errorDetails}) = 'object'`,
    ),
    check(
      "retrieval_runs_completion_valid",
      sql`(
        ${table.status} IN ('succeeded', 'failed', 'cancelled')
        AND ${table.completedAt} IS NOT NULL
      ) OR (
        ${table.status} IN ('pending', 'running')
        AND ${table.completedAt} IS NULL
      )`,
    ),
    check(
      "retrieval_runs_error_valid",
      sql`(
        ${table.status} = 'failed'
        AND ${table.errorDetails} <> '{}'::jsonb
      ) OR (
        ${table.status} <> 'failed'
        AND ${table.errorDetails} = '{}'::jsonb
      )`,
    ),
    check(
      "retrieval_runs_result_valid",
      sql`${table.status} <> 'succeeded' OR ${table.result} <> '{}'::jsonb`,
    ),
    unique("retrieval_runs_user_conversation_id_unique").on(
      table.userId,
      table.conversationId,
      table.id,
    ),
    index("retrieval_runs_user_workspace_status_created_idx").on(
      table.userId,
      table.workspaceId,
      table.status,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("retrieval_runs_conversation_created_idx").on(
      table.conversationId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    retrievalRunId: uuid("retrieval_run_id"),
    sequence: integer().notNull(),
    role: messageRole().notNull(),
    status: messageStatus().notNull().default("complete"),
    contentSchemaVersion: integer("content_schema_version").notNull().default(1),
    parts: jsonb().$type<MessagePart[]>().notNull().default([]),
    errorDetails: jsonb("error_details").$type<MessageErrorDetails>().notNull().default({}),
    createdAt: timestamp("created_at", { precision: 3, withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "messages_user_conversation_fk",
      columns: [table.userId, table.conversationId],
      foreignColumns: [conversations.userId, conversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "messages_user_conversation_retrieval_run_fk",
      columns: [table.userId, table.conversationId, table.retrievalRunId],
      foreignColumns: [retrievalRuns.userId, retrievalRuns.conversationId, retrievalRuns.id],
    }).onDelete("cascade"),
    unique("messages_conversation_sequence_unique").on(table.conversationId, table.sequence),
    unique("messages_retrieval_run_id_unique").on(table.retrievalRunId),
    check("messages_sequence_positive", sql`${table.sequence} > 0`),
    check(
      "messages_content_schema_version_positive",
      sql`${table.contentSchemaVersion} > 0`,
    ),
    check("messages_parts_array", sql`jsonb_typeof(${table.parts}) = 'array'`),
    check(
      "messages_complete_parts_present",
      sql`${table.status} <> 'complete' OR jsonb_array_length(${table.parts}) > 0`,
    ),
    check("messages_error_details_object", sql`jsonb_typeof(${table.errorDetails}) = 'object'`),
    check(
      "messages_error_valid",
      sql`(
        ${table.status} = 'failed'
        AND ${table.errorDetails} <> '{}'::jsonb
      ) OR (
        ${table.status} <> 'failed'
        AND ${table.errorDetails} = '{}'::jsonb
      )`,
    ),
    check(
      "messages_role_retrieval_run_valid",
      sql`(
        ${table.role} = 'user'
        AND ${table.status} = 'complete'
        AND ${table.retrievalRunId} IS NULL
      ) OR (
        ${table.role} = 'assistant'
        AND ${table.retrievalRunId} IS NOT NULL
      )`,
    ),
  ],
);

export const conversationsRelations = relations(conversations, ({ many, one }) => ({
  messages: many(messages),
  retrievalRuns: many(retrievalRuns),
  user: one(user, {
    fields: [conversations.userId],
    references: [user.id],
  }),
  workspace: one(workspaces, {
    fields: [conversations.userId, conversations.workspaceId],
    references: [workspaces.userId, workspaces.id],
  }),
}));

export const retrievalRunsRelations = relations(retrievalRuns, ({ one }) => ({
  message: one(messages),
  conversation: one(conversations, {
    fields: [retrievalRuns.userId, retrievalRuns.workspaceId, retrievalRuns.conversationId],
    references: [conversations.userId, conversations.workspaceId, conversations.id],
  }),
  user: one(user, {
    fields: [retrievalRuns.userId],
    references: [user.id],
  }),
  workspace: one(workspaces, {
    fields: [retrievalRuns.userId, retrievalRuns.workspaceId],
    references: [workspaces.userId, workspaces.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.userId, messages.conversationId],
    references: [conversations.userId, conversations.id],
  }),
  retrievalRun: one(retrievalRuns, {
    fields: [messages.userId, messages.conversationId, messages.retrievalRunId],
    references: [retrievalRuns.userId, retrievalRuns.conversationId, retrievalRuns.id],
  }),
  user: one(user, {
    fields: [messages.userId],
    references: [user.id],
  }),
}));

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type RetrievalRun = typeof retrievalRuns.$inferSelect;
export type NewRetrievalRun = typeof retrievalRuns.$inferInsert;
export type MessageRole = (typeof messageRole.enumValues)[number];
export type MessageStatus = (typeof messageStatus.enumValues)[number];
export type RetrievalRunStatus = (typeof retrievalRunStatus.enumValues)[number];
