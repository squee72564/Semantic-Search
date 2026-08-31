import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { workspaceDocuments } from "./workspace-documents.js";

describe("Workspace document schema", () => {
  it("defines contextual attachment metadata", () => {
    const columns = getTableColumns(workspaceDocuments);

    expect(Object.keys(columns)).toEqual([
      "userId",
      "workspaceId",
      "documentId",
      "displayTitle",
      "tags",
      "attachedAt",
      "updatedAt",
    ]);
    expect(columns.userId.notNull).toBe(true);
    expect(columns.workspaceId.notNull).toBe(true);
    expect(columns.documentId.notNull).toBe(true);
    expect(columns.displayTitle.notNull).toBe(false);
    expect(columns.tags.notNull).toBe(true);
    expect(columns.tags.hasDefault).toBe(true);
    expect(columns.attachedAt.hasDefault).toBe(true);
    expect(columns.updatedAt.hasDefault).toBe(true);
  });

  it("enforces same-owner attachments and contextual lookup indexes", () => {
    const config = getTableConfig(workspaceDocuments);

    expect(config.primaryKeys.map((key) => key.getName())).toEqual([
      "workspace_documents_workspace_id_document_id_pk",
    ]);
    expect(config.foreignKeys.map((key) => key.getName())).toEqual([
      "workspace_documents_user_id_user_id_fk",
      "workspace_documents_user_workspace_fk",
      "workspace_documents_user_document_fk",
    ]);
    expect(config.foreignKeys.map((key) => key.onDelete)).toEqual([
      "cascade",
      "cascade",
      "restrict",
    ]);
    expect(config.checks.map((constraint) => constraint.name)).toEqual([
      "workspace_documents_display_title_not_blank",
      "workspace_documents_tags_count",
      "workspace_documents_tags_not_null",
    ]);
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      "workspace_documents_user_workspace_attached_idx",
      "workspace_documents_user_document_idx",
      "workspace_documents_tags_idx",
    ]);
  });
});
