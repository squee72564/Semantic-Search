import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { user } from "./auth.js";
import { documents } from "./documents.js";
import { workspaces } from "./workspaces.js";

export const workspaceDocuments = pgTable(
  "workspace_documents",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull(),
    documentId: uuid("document_id").notNull(),
    displayTitle: varchar("display_title", { length: 255 }),
    tags: text()
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    attachedAt: timestamp("attached_at", { precision: 3, withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "workspace_documents_workspace_id_document_id_pk",
      columns: [table.workspaceId, table.documentId],
    }),
    foreignKey({
      name: "workspace_documents_user_workspace_fk",
      columns: [table.userId, table.workspaceId],
      foreignColumns: [workspaces.userId, workspaces.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "workspace_documents_user_document_fk",
      columns: [table.userId, table.documentId],
      foreignColumns: [documents.userId, documents.id],
    }).onDelete("restrict"),
    check(
      "workspace_documents_display_title_not_blank",
      sql`${table.displayTitle} IS NULL OR btrim(${table.displayTitle}) <> ''`,
    ),
    check("workspace_documents_tags_count", sql`cardinality(${table.tags}) <= 32`),
    check("workspace_documents_tags_not_null", sql`array_position(${table.tags}, NULL) IS NULL`),
    index("workspace_documents_user_workspace_attached_idx").on(
      table.userId,
      table.workspaceId,
      table.attachedAt.desc(),
      table.documentId,
    ),
    index("workspace_documents_user_document_idx").on(table.userId, table.documentId),
    index("workspace_documents_tags_idx").using("gin", table.tags),
  ],
);

export const documentsRelations = relations(documents, ({ many, one }) => ({
  user: one(user, {
    fields: [documents.userId],
    references: [user.id],
  }),
  workspaceDocuments: many(workspaceDocuments),
}));

export const workspacesRelations = relations(workspaces, ({ many, one }) => ({
  user: one(user, {
    fields: [workspaces.userId],
    references: [user.id],
  }),
  workspaceDocuments: many(workspaceDocuments),
}));

export const workspaceDocumentsRelations = relations(workspaceDocuments, ({ one }) => ({
  document: one(documents, {
    fields: [workspaceDocuments.userId, workspaceDocuments.documentId],
    references: [documents.userId, documents.id],
  }),
  user: one(user, {
    fields: [workspaceDocuments.userId],
    references: [user.id],
  }),
  workspace: one(workspaces, {
    fields: [workspaceDocuments.userId, workspaceDocuments.workspaceId],
    references: [workspaces.userId, workspaces.id],
  }),
}));

export type WorkspaceDocument = typeof workspaceDocuments.$inferSelect;
export type NewWorkspaceDocument = typeof workspaceDocuments.$inferInsert;
