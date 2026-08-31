import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { workspaces } from "./workspaces.js";

describe("Workspace schema", () => {
  it("defines the user-owned workspace fields", () => {
    const columns = getTableColumns(workspaces);

    expect(Object.keys(columns)).toEqual([
      "id",
      "userId",
      "name",
      "description",
      "createdAt",
      "updatedAt",
    ]);
    expect(columns.id.primary).toBe(true);
    expect(columns.id.hasDefault).toBe(true);
    expect(columns.userId.notNull).toBe(true);
    expect(columns.name.notNull).toBe(true);
    expect(columns.description.notNull).toBe(false);
    expect(columns.createdAt.hasDefault).toBe(true);
    expect(columns.updatedAt.hasDefault).toBe(true);
  });

  it("defines ownership and listing constraints", () => {
    const config = getTableConfig(workspaces);

    expect(config.foreignKeys).toHaveLength(1);
    expect(config.foreignKeys[0]?.onDelete).toBe("cascade");
    expect(config.checks.map((constraint) => constraint.name)).toEqual([
      "workspaces_name_not_blank",
    ]);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toEqual([
      "workspaces_user_id_id_unique",
    ]);
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      "workspaces_user_created_idx",
    ]);
  });
});
