import { http, HttpResponse } from "msw";

export const workspaceFixtures = [
  {
    id: "0198b3f4-6fb4-7000-8000-000000000101",
    userId: "user-1",
    name: "Research library",
    description: "Papers and notes for the semantic search project",
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
  },
  {
    id: "0198b3f4-6fb4-7000-8000-000000000102",
    userId: "user-1",
    name: "Product planning",
    description: null,
    createdAt: "2026-08-10T12:00:00.000Z",
    updatedAt: "2026-08-10T12:00:00.000Z",
  },
];

export const apiHandlers = [
  http.get("*/workspaces", ({ request }) => {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "20");
    return HttpResponse.json({
      items: workspaceFixtures.slice(0, limit),
      limit,
      pageInfo: { nextCursor: null },
    });
  }),
  http.post("*/workspaces", async ({ request }) => {
    const body = (await request.json()) as { name: string; description?: string | null };
    return HttpResponse.json(
      {
        item: {
          ...workspaceFixtures[0],
          name: body.name,
          description: body.description ?? null,
        },
      },
      { status: 201, headers: { Location: `/workspaces/${workspaceFixtures[0]!.id}` } },
    );
  }),
  http.get("*/workspaces/:id", ({ params }) => {
    const workspace = workspaceFixtures.find((item) => item.id === params.id);
    return workspace
      ? HttpResponse.json({ item: workspace })
      : HttpResponse.json({ title: "Not found" }, { status: 404 });
  }),
  http.patch("*/workspaces/:id", async ({ params, request }) => {
    const workspace = workspaceFixtures.find((item) => item.id === params.id);
    if (!workspace) return HttpResponse.json({ title: "Not found" }, { status: 404 });
    const body = (await request.json()) as { name?: string; description?: string | null };
    return HttpResponse.json({
      item: { ...workspace, ...body, updatedAt: "2026-08-30T12:00:00.000Z" },
    });
  }),
  http.delete("*/workspaces/:id", ({ params }) => {
    return workspaceFixtures.some((item) => item.id === params.id)
      ? new HttpResponse(null, { status: 204 })
      : HttpResponse.json({ title: "Not found" }, { status: 404 });
  }),
];
