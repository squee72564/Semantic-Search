import type {
  Document,
  DocumentRepository,
  Workspace,
  WorkspaceDocument,
  WorkspaceRepository,
} from "@repo/db";
import { Hono, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AppVariables } from "../../lib/context.js";
import { ApiError } from "../../lib/error.js";
import { encodeDocumentCursor, encodeWorkspaceDocumentCursor } from "../../validation/document.js";
import { createDocumentRoutes, createWorkspaceDocumentRoutes } from "./document.js";

type AppEnv = { Variables: AppVariables };

const createdAt = new Date("2026-08-30T12:00:00.000Z");
const attachedAt = new Date("2026-08-30T12:30:00.000Z");
const updatedAt = new Date("2026-08-30T13:00:00.000Z");
const userId = "user-1";
const documentId = "0198b3f4-6fb4-7000-8000-000000000001";
const workspaceId = "0198b3f4-6fb4-7000-8000-000000000002";

const document: Document = {
  createdAt,
  customMetadata: { source: "manual" },
  description: "Canonical description",
  id: documentId,
  originalContentType: "application/pdf",
  originalFilename: "source.pdf",
  originalObjectKey: `users/${userId}/documents/${documentId}/original.pdf`,
  originalSizeBytes: 1024,
  pageCount: null,
  sha256: "a".repeat(64),
  status: "uploaded",
  title: "Source",
  updatedAt,
  userId,
};

const attachment: WorkspaceDocument = {
  attachedAt,
  displayTitle: "Workspace source",
  documentId,
  tags: ["tax"],
  updatedAt,
  userId,
  workspaceId,
};

const workspace: Workspace = {
  createdAt,
  description: "Reference material",
  id: workspaceId,
  name: "Research",
  updatedAt,
  userId,
};

function createDocumentRepository(overrides: Partial<DocumentRepository> = {}): DocumentRepository {
  return {
    attach: vi.fn<DocumentRepository["attach"]>(async () => attachment),
    create: vi.fn<DocumentRepository["create"]>(async () => document),
    detach: vi.fn<DocumentRepository["detach"]>(async () => true),
    findById: vi.fn<DocumentRepository["findById"]>(async () => document),
    findBySha256: vi.fn<DocumentRepository["findBySha256"]>(async () => document),
    list: vi.fn<DocumentRepository["list"]>(async () => ({
      items: [document],
      nextCursor: { createdAt, id: documentId },
    })),
    listWorkspaceDocuments: vi.fn<DocumentRepository["listWorkspaceDocuments"]>(async () => ({
      items: [{ attachment, document }],
      nextCursor: { attachedAt, id: documentId },
    })),
    markDeletingIfUnattached: vi.fn<DocumentRepository["markDeletingIfUnattached"]>(async () => ({
      ...document,
      status: "deleting",
    })),
    updateAttachment: vi.fn<DocumentRepository["updateAttachment"]>(async () => attachment),
    updateMetadata: vi.fn<DocumentRepository["updateMetadata"]>(async () => ({
      ...document,
      title: "Renamed",
    })),
    ...overrides,
  };
}

function createWorkspaceRepository(
  overrides: Partial<WorkspaceRepository> = {},
): WorkspaceRepository {
  return {
    create: vi.fn<WorkspaceRepository["create"]>(async () => workspace),
    delete: vi.fn<WorkspaceRepository["delete"]>(async () => true),
    findById: vi.fn<WorkspaceRepository["findById"]>(async () => workspace),
    list: vi.fn<WorkspaceRepository["list"]>(async () => ({
      items: [workspace],
      nextCursor: null,
    })),
    update: vi.fn<WorkspaceRepository["update"]>(async () => workspace),
    ...overrides,
  };
}

function createTestApp({
  authenticated = true,
  documents = createDocumentRepository(),
  workspaces = createWorkspaceRepository(),
}: {
  authenticated?: boolean;
  documents?: DocumentRepository;
  workspaces?: WorkspaceRepository;
} = {}) {
  const requireAuth: MiddlewareHandler<AppEnv> = async (context, next) => {
    if (!authenticated) return context.json({ code: "UNAUTHENTICATED" }, 401);

    context.set("currentUser", {
      createdAt,
      email: "user@example.com",
      emailVerified: true,
      id: userId,
      image: null,
      name: "Test User",
      updatedAt,
    });
    context.set("session", null);
    return next();
  };
  const app = new Hono<AppEnv>()
    .route("/documents", createDocumentRoutes(documents, requireAuth))
    .route(
      "/workspaces/:workspaceId/documents",
      createWorkspaceDocumentRoutes(documents, workspaces, requireAuth),
    );

  app.onError((error, context) => {
    if (error instanceof ApiError) {
      return context.json({ code: error.code, status: error.status }, error.status);
    }

    throw error;
  });

  return app;
}

describe("canonical document routes", () => {
  it("supports list, read, metadata update, and deletion initiation", async () => {
    const repository = createDocumentRepository();
    const app = createTestApp({ documents: repository });

    const listResponse = await app.request("/documents?limit=1&tag=Tax&tag=reference");
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody).toMatchObject({
      items: [{ id: documentId }],
      limit: 1,
      pageInfo: { nextCursor: encodeDocumentCursor({ createdAt, id: documentId }) },
    });
    expect(JSON.stringify(listBody)).not.toContain("originalObjectKey");
    expect(JSON.stringify(listBody)).not.toContain('"userId"');
    expect(repository.list).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 1,
      status: undefined,
      tags: ["tax", "reference"],
      userId,
      workspaceId: undefined,
    });

    const readResponse = await app.request(`/documents/${documentId}`);
    expect(readResponse.status).toBe(200);
    expect(repository.findById).toHaveBeenCalledWith(userId, documentId);

    const updateResponse = await app.request(`/documents/${documentId}`, {
      body: JSON.stringify({ description: null, title: "  Renamed  " }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    expect(updateResponse.status).toBe(200);
    expect(repository.updateMetadata).toHaveBeenCalledWith(userId, documentId, {
      description: null,
      title: "Renamed",
    });

    const deleteResponse = await app.request(`/documents/${documentId}`, { method: "DELETE" });
    expect(deleteResponse.status).toBe(202);
    await expect(deleteResponse.json()).resolves.toMatchObject({
      item: { id: documentId, status: "deleting" },
    });
    expect(repository.markDeletingIfUnattached).toHaveBeenCalledWith(userId, documentId);
  });

  it("requires authentication and rejects invalid requests before repository calls", async () => {
    const repository = createDocumentRepository();
    const unauthenticated = await createTestApp({
      authenticated: false,
      documents: repository,
    }).request("/documents");
    const invalid = await createTestApp({ documents: repository }).request(
      `/documents/${documentId}`,
      {
        body: JSON.stringify({ userId: "user-2" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );

    expect(unauthenticated.status).toBe(401);
    expect(invalid.status).toBe(400);
    expect(repository.list).not.toHaveBeenCalled();
    expect(repository.updateMetadata).not.toHaveBeenCalled();
  });

  it("distinguishes missing documents from attached deletion conflicts", async () => {
    const attachedRepository = createDocumentRepository({
      markDeletingIfUnattached: vi.fn<DocumentRepository["markDeletingIfUnattached"]>(
        async () => null,
      ),
    });
    const missingRepository = createDocumentRepository({
      findById: vi.fn<DocumentRepository["findById"]>(async () => null),
      markDeletingIfUnattached: vi.fn<DocumentRepository["markDeletingIfUnattached"]>(
        async () => null,
      ),
    });

    const attachedResponse = await createTestApp({ documents: attachedRepository }).request(
      `/documents/${documentId}`,
      { method: "DELETE" },
    );
    const missingResponse = await createTestApp({ documents: missingRepository }).request(
      `/documents/${documentId}`,
      { method: "DELETE" },
    );

    expect(attachedResponse.status).toBe(409);
    await expect(attachedResponse.json()).resolves.toMatchObject({ code: "DOCUMENT_ATTACHED" });
    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });
});

describe("workspace document routes", () => {
  it("supports attachment-aware listing, attach, update, and detach", async () => {
    const documents = createDocumentRepository();
    const workspaces = createWorkspaceRepository();
    const app = createTestApp({ documents, workspaces });
    const path = `/workspaces/${workspaceId}/documents`;

    const listResponse = await app.request(`${path}?limit=1&tag=Tax`);
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody).toMatchObject({
      items: [
        {
          attachment: { documentId, tags: ["tax"], workspaceId },
          document: { id: documentId },
        },
      ],
      limit: 1,
      pageInfo: {
        nextCursor: encodeWorkspaceDocumentCursor({ attachedAt, id: documentId }),
      },
    });
    expect(JSON.stringify(listBody)).not.toContain("originalObjectKey");
    expect(workspaces.findById).toHaveBeenCalledWith(userId, workspaceId);
    expect(documents.listWorkspaceDocuments).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 1,
      status: undefined,
      tags: ["tax"],
      userId,
      workspaceId,
    });

    const attachResponse = await app.request(`${path}/${documentId}`, {
      body: JSON.stringify({ displayTitle: "  Workspace source  ", tags: [" Tax "] }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    expect(attachResponse.status).toBe(200);
    expect(documents.attach).toHaveBeenCalledWith(userId, workspaceId, documentId, {
      displayTitle: "Workspace source",
      tags: ["tax"],
    });

    const updateResponse = await app.request(`${path}/${documentId}`, {
      body: JSON.stringify({ displayTitle: null, tags: [" Reference "] }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    expect(updateResponse.status).toBe(200);
    expect(documents.updateAttachment).toHaveBeenCalledWith(userId, workspaceId, documentId, {
      displayTitle: null,
      tags: ["reference"],
    });

    const detachResponse = await app.request(`${path}/${documentId}`, { method: "DELETE" });
    expect(detachResponse.status).toBe(204);
    expect(documents.detach).toHaveBeenCalledWith(userId, workspaceId, documentId);
  });

  it("does not turn an inaccessible workspace into an empty list", async () => {
    const documents = createDocumentRepository();
    const workspaces = createWorkspaceRepository({
      findById: vi.fn<WorkspaceRepository["findById"]>(async () => null),
    });
    const response = await createTestApp({ documents, workspaces }).request(
      `/workspaces/${workspaceId}/documents`,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    expect(documents.listWorkspaceDocuments).not.toHaveBeenCalled();
  });

  it("uses one non-disclosing not-found response for attachment mutations", async () => {
    const documents = createDocumentRepository({
      attach: vi.fn<DocumentRepository["attach"]>(async () => null),
      detach: vi.fn<DocumentRepository["detach"]>(async () => false),
      updateAttachment: vi.fn<DocumentRepository["updateAttachment"]>(async () => null),
    });
    const app = createTestApp({ documents });
    const path = `/workspaces/${workspaceId}/documents/${documentId}`;
    const responses = await Promise.all([
      app.request(path, {
        body: "{}",
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
      app.request(path, {
        body: JSON.stringify({ tags: [] }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }),
      app.request(path, { method: "DELETE" }),
    ]);

    for (const response of responses) expect(response.status).toBe(404);

    const problems = await Promise.all(responses.map((response) => response.json()));

    for (const problem of problems) {
      expect(problem).toMatchObject({
        code: "WORKSPACE_DOCUMENT_NOT_FOUND",
      });
    }
  });
});
