import { Hono } from "hono";
import { type DocumentRepository, type WorkspaceRepository } from "@repo/db";
import { createHealthRoutes } from "./routes/v1/health.js";
import {
  createDocumentRoutes,
  createWorkspaceDocumentRoutes,
  createDocumentUploadRoutes,
  createWorkspaceDocumentUploadRoutes,
} from "./routes/v1/document.js";
import { createWorkspaceRoutes } from "./routes/v1/workspace.js";
import type { AppVariables } from "./lib/context.js";
import { type ApiEnv } from "@repo/env/api";
import { createErrorHandler } from "./http/error-handler.js";
import type { Logger } from "./lib/logger.js";
import { createNotFoundHandler } from "./http/not-found.js";
import { createRequestIdMiddleware } from "./middleware/request-id.js";
import { createRequestLoggerMiddleware } from "./middleware/request-logger.js";
import {
  createCsrfProtection,
  createSecurityHeaders,
  createRequestBodyLimit,
} from "./middleware/security.js";
import { type ApiAuthentication, createAuthenticationMiddleware } from "./lib/auth.js";
import type { UploadDocument } from "./uploads/service.js";

export interface AppDependencies {
  auth: ApiAuthentication;
  documents: DocumentRepository;
  workspaces: WorkspaceRepository;
  env: ApiEnv;
  logger: Logger;
  uploadDocument: UploadDocument;
}

export function createApp({
  auth,
  documents,
  workspaces,
  env,
  logger,
  uploadDocument,
}: AppDependencies) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("*", createRequestIdMiddleware());
  app.use("*", createRequestLoggerMiddleware(logger));
  app.use("*", createSecurityHeaders(env));

  const { requireAuth } = createAuthenticationMiddleware({ auth });
  // Uploads enforce streamed byte limits after CSRF, authentication, and ownership checks.
  const upload = {
    execute: uploadDocument,
    limits: {
      maxFileBytes: env.UPLOAD_MAX_FILE_BYTES,
      maxMetadataBytes: env.UPLOAD_MAX_METADATA_BYTES,
      maxOverheadBytes: env.UPLOAD_MAX_OVERHEAD_BYTES,
    },
  };
  const uploads = app
    .route(
      "/documents",
      createDocumentUploadRoutes(requireAuth(), createCsrfProtection(env), upload),
    )
    .route(
      "/workspaces/:workspaceId/documents",
      createWorkspaceDocumentUploadRoutes(requireAuth(), createCsrfProtection(env), upload),
    );
  uploads.use("*", createRequestBodyLimit(env));

  // Better Auth performs endpoint-aware origin, CSRF, and protocol validation.
  // Register it before the generic form CSRF middleware to avoid rejecting
  // legitimate OAuth and server-to-server form/token requests.
  app.on(["GET", "POST"], "/api/auth/*", (context) => auth.handler(context.req.raw));

  app.use("*", createCsrfProtection(env));

  const routes = uploads
    .route("/health", createHealthRoutes())
    .route("/workspaces", createWorkspaceRoutes(workspaces, requireAuth()))
    .route("/documents", createDocumentRoutes(documents, requireAuth()))
    .route(
      "/workspaces/:workspaceId/documents",
      createWorkspaceDocumentRoutes(documents, workspaces, requireAuth()),
    );

  routes.onError(createErrorHandler(env, logger));
  routes.notFound(createNotFoundHandler(env));

  return routes;
}

export type AppType = ReturnType<typeof createApp>;
