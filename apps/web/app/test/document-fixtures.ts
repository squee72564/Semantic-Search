import type { DocumentItem } from "~/queries/documents";

export const documentFixture: DocumentItem = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Research notes",
  description: "Notes from the first study.",
  originalFilename: "research.pdf",
  originalContentType: "application/pdf",
  originalSizeBytes: 1024,
  sha256: "a".repeat(64),
  customMetadata: {},
  pageCount: null,
  status: "uploaded",
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
};
export const documentPage = {
  items: [documentFixture],
  limit: 20,
  pageInfo: { nextCursor: null as string | null },
};
