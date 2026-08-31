import { relations, sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";

import { user } from "./auth.js";

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: varchar({ length: 255 }).notNull(),
    description: text(),
    createdAt: timestamp("created_at", { precision: 3, withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("workspaces_name_not_blank", sql`btrim(${table.name}) <> ''`),
    unique("workspaces_user_id_id_unique").on(table.userId, table.id),
    index("workspaces_user_created_idx").on(table.userId, table.createdAt.desc(), table.id.desc()),
  ],
);

export const workspacesRelations = relations(workspaces, ({ one }) => ({
  user: one(user, {
    fields: [workspaces.userId],
    references: [user.id],
  }),
}));

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
