import { sql } from "drizzle-orm";
import {
  bigint,
  check,
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

export const documentStatus = pgEnum("document_status", [
  "uploaded",
  "processing",
  "ready",
  "failed",
  "deleting",
]);

export const documents = pgTable(
  "documents",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sha256: varchar({ length: 64 }).notNull(),
    originalFilename: varchar("original_filename", { length: 255 }).notNull(),
    title: varchar({ length: 255 }),
    description: text(),
    customMetadata: jsonb("custom_metadata").$type<Record<string, unknown>>().notNull().default({}),
    originalObjectKey: text("original_object_key").notNull(),
    originalSizeBytes: bigint("original_size_bytes", { mode: "number" }).notNull(),
    originalContentType: varchar("original_content_type", { length: 255 }).notNull(),
    pageCount: integer("page_count"),
    status: documentStatus().notNull().default("uploaded"),
    createdAt: timestamp("created_at", { precision: 3, withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("documents_sha256_format", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check("documents_original_filename_not_blank", sql`btrim(${table.originalFilename}) <> ''`),
    check("documents_title_not_blank", sql`${table.title} IS NULL OR btrim(${table.title}) <> ''`),
    check(
      "documents_custom_metadata_object",
      sql`jsonb_typeof(${table.customMetadata}) = 'object'`,
    ),
    check("documents_original_object_key_not_blank", sql`btrim(${table.originalObjectKey}) <> ''`),
    check("documents_original_size_positive", sql`${table.originalSizeBytes} > 0`),
    check(
      "documents_page_count_positive",
      sql`${table.pageCount} IS NULL OR ${table.pageCount} > 0`,
    ),
    unique("documents_user_id_id_unique").on(table.userId, table.id),
    unique("documents_user_sha256_unique").on(table.userId, table.sha256),
    unique("documents_original_object_key_unique").on(table.originalObjectKey),
    index("documents_user_created_idx").on(table.userId, table.createdAt.desc(), table.id.desc()),
    index("documents_user_updated_idx").on(table.userId, table.updatedAt.desc(), table.id.desc()),
    index("documents_user_status_created_idx").on(
      table.userId,
      table.status,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentStatus = (typeof documentStatus.enumValues)[number];
