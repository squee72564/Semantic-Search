import { Hono } from "hono";

export function createHealthRoutes() {
  return new Hono().get("/", (context) => context.json({ status: "ok" as const }, 200));
}
