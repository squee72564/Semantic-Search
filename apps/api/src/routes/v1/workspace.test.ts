import type { Workspace, WorkspaceRepository } from "@repo/db";
import { Hono, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AppVariables } from "../../lib/context.js";
import { ApiError } from "../../lib/error.js";
import { createWorkspaceRoutes } from "./workspace.js";

type AppEnv = { Variables: AppVariables };

const createdAt = new Date("2026-08-30T12:00:00.000Z");
const updatedAt = new Date("2026-08-30T13:00:00.000Z");
const userId = "user-1";
const workspaceId = "0198b3f4-6fb4-7000-8000-000000000001";
const workspace: Workspace = {
  createdAt,
  description: "Reference material",
  id: workspaceId,
  name: "Research",
  updatedAt,
  userId,
};

function createRepository(overrides: Partial<WorkspaceRepository> = {}): WorkspaceRepository {
  return {
    create: vi.fn<WorkspaceRepository["create"]>(async () => workspace),
    delete: vi.fn<WorkspaceRepository["delete"]>(async () => true),
    findById: vi.fn<WorkspaceRepository["findById"]>(async () => workspace),
    list: vi.fn<WorkspaceRepository["list"]>(async () => ({
      hasMore: true,
      items: [workspace],
    })),
    update: vi.fn<WorkspaceRepository["update"]>(async () => ({
      ...workspace,
      name: "Renamed",
    })),
    ...overrides,
  };
}

function createTestApp(repository: WorkspaceRepository, authenticated = true) {
  const requireAuth: MiddlewareHandler<AppEnv> = async (context, next) => {
    if (!authenticated) {
      return context.json({ code: "UNAUTHENTICATED" }, 401);
    }

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
  const app = new Hono<AppEnv>().route(
    "/workspaces",
    createWorkspaceRoutes(repository, requireAuth),
  );

  app.onError((error, context) => {
    if (error instanceof ApiError) {
      return context.json({ code: error.code, status: error.status }, error.status);
    }

    throw error;
  });

  return app;
}

describe("workspace routes", () => {
  it("supports the complete authenticated CRUD lifecycle", async () => {
    const repository = createRepository();
    const app = createTestApp(repository);

    const listResponse = await app.request("/workspaces?limit=1");
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      items: [{ id: workspaceId }],
      limit: 1,
      pageInfo: { hasMore: true },
    });
    expect(repository.list).toHaveBeenCalledWith({ limit: 1, userId });

    const createResponse = await app.request("/workspaces", {
      body: JSON.stringify({ description: "  Reference material  ", name: "  Research  " }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(createResponse.status).toBe(201);
    expect(createResponse.headers.get("location")).toBe(`/workspaces/${workspaceId}`);
    expect(repository.create).toHaveBeenCalledWith(userId, {
      description: "Reference material",
      name: "Research",
    });

    const readResponse = await app.request(`/workspaces/${workspaceId}`);
    expect(readResponse.status).toBe(200);
    expect(repository.findById).toHaveBeenCalledWith(userId, workspaceId);

    const updateResponse = await app.request(`/workspaces/${workspaceId}`, {
      body: JSON.stringify({ description: null, name: "  Renamed  " }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    expect(updateResponse.status).toBe(200);
    expect(repository.update).toHaveBeenCalledWith(userId, workspaceId, {
      description: null,
      name: "Renamed",
    });

    const deleteResponse = await app.request(`/workspaces/${workspaceId}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(204);
    expect(await deleteResponse.text()).toBe("");
    expect(repository.delete).toHaveBeenCalledWith(userId, workspaceId);
  });

  it("requires authentication before invoking the repository", async () => {
    const repository = createRepository();
    const response = await createTestApp(repository, false).request("/workspaces");

    expect(response.status).toBe(401);
    expect(repository.list).not.toHaveBeenCalled();
  });

  it("returns validation errors for invalid requests", async () => {
    const repository = createRepository();
    const app = createTestApp(repository);
    const invalidBody = await app.request("/workspaces", {
      body: JSON.stringify({ name: "   ", userId: "user-2" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const invalidPath = await app.request("/workspaces/not-a-uuid");

    expect(invalidBody.status).toBe(400);
    await expect(invalidBody.json()).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(invalidPath.status).toBe(400);
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it("uses the same not-found response for inaccessible reads, updates, and deletes", async () => {
    const repository = createRepository({
      delete: vi.fn<WorkspaceRepository["delete"]>(async () => false),
      findById: vi.fn<WorkspaceRepository["findById"]>(async () => null),
      update: vi.fn<WorkspaceRepository["update"]>(async () => null),
    });
    const app = createTestApp(repository);
    const readResponse = await app.request(`/workspaces/${workspaceId}`);
    const updateResponse = await app.request(`/workspaces/${workspaceId}`, {
      body: JSON.stringify({ name: "Renamed" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const deleteResponse = await app.request(`/workspaces/${workspaceId}`, { method: "DELETE" });

    const responses = [readResponse, updateResponse, deleteResponse];

    for (const response of responses) {
      expect(response.status).toBe(404);
    }

    const problems = await Promise.all(responses.map((response) => response.json()));

    for (const problem of problems) {
      expect(problem).toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    }
  });
});
