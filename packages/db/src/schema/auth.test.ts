import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { account, session, user, verification } from "./auth.js";

describe("Better Auth schema", () => {
  it("contains the generated core tables", () => {
    expect([user, session, account, verification].map(getTableName)).toEqual([
      "user",
      "session",
      "account",
      "verification",
    ]);
  });

  it("keeps the fields required by the runtime adapter", () => {
    expect(Object.keys(getTableColumns(user))).toEqual([
      "id",
      "name",
      "email",
      "emailVerified",
      "image",
      "createdAt",
      "updatedAt",
    ]);
    expect(Object.keys(getTableColumns(session))).toContain("userId");
    expect(Object.keys(getTableColumns(account))).toContain("providerId");
    expect(Object.keys(getTableColumns(verification))).toContain("identifier");
  });
});
