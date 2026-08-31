import { Hono } from "hono";
import { type WorkspaceRepository } from "@repo/db";
import { createHealthRoutes } from "./routes/v1/health.js";
import { createWorkspaceRoutes } from "./routes/v1/workspace.js";
import type { AppVariables } from "./lib/context.js";
import { type ApiEnv } from "@repo/env/api";
import { createErrorHandler } from "./http/error-handler.js";
import type { Logger } from "./lib/logger.js";
import { createNotFoundHandler } from "./http/not-found.js";
import { createRequestIdMiddleware } from "./middleware/request-id.js";
import { createRequestLoggerMiddleware } from "./middleware/request-logger.js";
import { createCsrfProtection, createSecurityMiddleware } from "./middleware/security.js";
import { type ApiAuthentication, createAuthenticationMiddleware } from "./lib/auth.js";

export interface AppDependencies {
  auth: ApiAuthentication;
  workspaces: WorkspaceRepository;
  env: ApiEnv;
  logger: Logger;
}

export function createApp({ auth, workspaces, env, logger }: AppDependencies) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("*", createRequestIdMiddleware());
  app.use("*", createRequestLoggerMiddleware(logger));
  app.use("*", ...createSecurityMiddleware(env));

  // Better Auth performs endpoint-aware origin, CSRF, and protocol validation.
  // Register it before the generic form CSRF middleware to avoid rejecting
  // legitimate OAuth and server-to-server form/token requests.
  app.on(["GET", "POST"], "/api/auth/*", (context) => auth.handler(context.req.raw));

  app.use("*", createCsrfProtection(env));

  const { requireAuth } = createAuthenticationMiddleware({ auth });

  const routes = app
    .route("/health", createHealthRoutes())
    .route("/workspaces", createWorkspaceRoutes(workspaces, requireAuth()));

  routes.onError(createErrorHandler(env, logger));
  routes.notFound(createNotFoundHandler(env));

  return routes;
}

export type AppType = ReturnType<typeof createApp>;
