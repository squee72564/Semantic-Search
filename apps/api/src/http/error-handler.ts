import type { ErrorHandler } from "hono";
import { type AppVariables, REQUEST_ID_CONTEXT_KEY } from "../lib/context.js";
import { ApiError, toApiError } from "../lib/error.js";
import { DocumentDeletingError } from "@repo/db";
import type { ApiEnv } from "@repo/env/api";
import type { Logger } from "../lib/logger.js";

export function createErrorHandler(env: ApiEnv, logger: Logger) {
  const errorHandler: ErrorHandler<{ Variables: AppVariables }> = (error, context) => {
    const requestId = context.get(REQUEST_ID_CONTEXT_KEY);
    const apiError = toApiError(
      error instanceof DocumentDeletingError
        ? new ApiError({
            status: 409,
            code: "DOCUMENT_DELETING",
            message: error.message,
            userMessage: "This document is being deleted. Please retry later.",
            expose: true,
          })
        : error,
      {
        metadata: {
          method: context.req.method,
          path: context.req.path,
        },
        requestId,
        tags: ["http"],
      },
    );

    logger.error(
      {
        err: apiError,
        error: apiError.toLogObject(),
        method: context.req.method,
        path: context.req.path,
        requestId,
        status: apiError.status,
      },
      "request failed",
    );

    return context.json(
      apiError.toProblem(env, {
        instance: context.req.path,
        requestId,
      }),
      apiError.status,
    );
  };

  return errorHandler;
}
