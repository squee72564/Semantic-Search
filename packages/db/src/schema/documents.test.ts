import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { documents, documentStatus } from "./documents.js";

describe("Document schema", () => {
  it("defines canonical PDF identity and metadata", () => {
    const columns = getTableColumns(documents);

    expect(Object.keys(columns)).toEqual([
      "id",
      "userId",
      "sha256",
      "originalFilename",
      "title",
      "description",
      "customMetadata",
      "originalObjectKey",
      "originalSizeBytes",
      "originalContentType",
      "pageCount",
      "status",
      "createdAt",
      "updatedAt",
    ]);
    expect(columns.id.primary).toBe(true);
    expect(columns.id.hasDefault).toBe(true);
    expect(columns.userId.notNull).toBe(true);
    expect(columns.customMetadata.hasDefault).toBe(true);
    expect(columns.pageCount.notNull).toBe(false);
    expect(columns.status.hasDefault).toBe(true);
    expect(documentStatus.enumValues).toEqual([
      "uploaded",
      "processing",
      "ready",
      "failed",
      "deleting",
    ]);
  });

  it("defines integrity, ownership, deduplication, and listing constraints", () => {
    const config = getTableConfig(documents);

    expect(config.foreignKeys).toHaveLength(1);
    expect(config.foreignKeys[0]?.onDelete).toBe("cascade");
    expect(config.checks.map((constraint) => constraint.name)).toEqual([
      "documents_sha256_format",
      "documents_original_filename_not_blank",
      "documents_title_not_blank",
      "documents_custom_metadata_object",
      "documents_original_object_key_not_blank",
      "documents_original_size_positive",
      "documents_page_count_positive",
    ]);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toEqual([
      "documents_user_id_id_unique",
      "documents_user_sha256_unique",
      "documents_original_object_key_unique",
    ]);
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      "documents_user_created_idx",
      "documents_user_updated_idx",
      "documents_user_status_created_idx",
    ]);
  });
});
