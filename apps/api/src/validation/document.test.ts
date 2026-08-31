import { describe, expect, it } from "vitest";

import {
  attachDocumentSchema,
  documentsQuerySchema,
  encodeDocumentCursor,
  encodeWorkspaceDocumentCursor,
  updateDocumentMetadataSchema,
  updateWorkspaceDocumentSchema,
  workspaceDocumentParamsSchema,
  workspaceDocumentsQuerySchema,
} from "./document.js";

const documentId = "0198b3f4-6fb4-7000-8000-000000000001";
const workspaceId = "0198b3f4-6fb4-7000-8000-000000000002";

describe("document validation", () => {
  it("round-trips canonical and attachment cursors", () => {
    const createdAt = new Date("2026-08-01T12:00:00.000Z");
    const attachedAt = new Date("2026-08-02T12:00:00.000Z");

    expect(
      documentsQuerySchema.parse({ cursor: encodeDocumentCursor({ createdAt, id: documentId }) }),
    ).toEqual({ cursor: { createdAt, id: documentId }, limit: 20 });
    expect(
      workspaceDocumentsQuerySchema.parse({
        cursor: encodeWorkspaceDocumentCursor({ attachedAt, id: documentId }),
      }),
    ).toEqual({ cursor: { attachedAt, id: documentId }, limit: 20 });
  });

  it("normalizes singleton and repeated query tags", () => {
    expect(documentsQuerySchema.parse({ tag: "  TAX  " })).toMatchObject({ tag: ["tax"] });
    expect(documentsQuerySchema.parse({ tag: [" Tax ", "REFERENCE", "tax"] })).toMatchObject({
      tag: ["tax", "reference"],
    });
  });

  it("validates list filters, UUIDs, and limits", () => {
    expect(documentsQuerySchema.parse({ limit: "10", status: "ready", workspaceId })).toEqual({
      limit: 10,
      status: "ready",
      workspaceId,
    });
    expect(workspaceDocumentParamsSchema.safeParse({ documentId, workspaceId }).success).toBe(true);
    expect(documentsQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(documentsQuerySchema.safeParse({ status: "unknown" }).success).toBe(false);
    expect(workspaceDocumentParamsSchema.safeParse({ documentId: "1", workspaceId }).success).toBe(
      false,
    );
  });

  it("normalizes document and attachment update bodies", () => {
    expect(
      updateDocumentMetadataSchema.parse({
        customMetadata: { source: "manual" },
        description: "  Reference material  ",
        title: "  Source  ",
      }),
    ).toEqual({
      customMetadata: { source: "manual" },
      description: "Reference material",
      title: "Source",
    });
    expect(
      attachDocumentSchema.parse({ displayTitle: "  Workspace source  ", tags: [" Tax ", "tax"] }),
    ).toEqual({ displayTitle: "Workspace source", tags: ["tax"] });
  });

  it("rejects malformed cursors, invalid tags, unknown fields, and empty patches", () => {
    expect(documentsQuerySchema.safeParse({ cursor: "not-a-cursor" }).success).toBe(false);
    expect(documentsQuerySchema.safeParse({ tag: [" "] }).success).toBe(false);
    expect(
      attachDocumentSchema.safeParse({ tags: Array.from({ length: 33 }, (_, i) => `t${i}`) })
        .success,
    ).toBe(false);
    expect(updateDocumentMetadataSchema.safeParse({}).success).toBe(false);
    expect(updateDocumentMetadataSchema.safeParse({ userId: "user-2" }).success).toBe(false);
    expect(updateWorkspaceDocumentSchema.safeParse({}).success).toBe(false);
  });
});
