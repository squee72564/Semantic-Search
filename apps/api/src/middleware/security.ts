import type { ApiEnv } from "@repo/env/api";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { StatusCodes } from "http-status-codes";

import { type AppVariables, REQUEST_ID_CONTEXT_KEY } from "../lib/context.js";
import { ApiError } from "../lib/error.js";

const MAX_REQUEST_BODY_SIZE = 1024 * 1024;
const PROBLEM_JSON_CONTENT_TYPE = "application/problem+json";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const FORM_CONTENT_TYPES = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);
const VALID_SEC_FETCH_SITES = new Set(["cross-site", "same-origin", "same-site", "none"]);

type ApiMiddleware = MiddlewareHandler<{ Variables: AppVariables }>;

const createErrorResponse = (
  env: ApiEnv,
  status: StatusCodes.FORBIDDEN | StatusCodes.REQUEST_TOO_LONG,
  code: string,
  message: string,
  userMessage: string,
  instance: string,
  requestId?: string,
) => {
  const error = new ApiError({
    code,
    expose: true,
    message,
    requestId,
    status,
    userMessage,
  });

  return error.toProblem(env, {
    instance,
    requestId: requestId ?? "",
  });
};

export const createSecurityHeaders = (env: ApiEnv): ApiMiddleware => {
  const headers = secureHeaders({
    // API responses should never be rendered as active browser content.
    contentSecurityPolicy: {
      baseUri: ["'none'"],
      defaultSrc: ["'none'"],
      formAction: ["'none'"],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity:
      env.NODE_ENV === "production" ? "max-age=63072000; includeSubDomains" : false,
    xFrameOptions: "DENY",
  });

  return async (context, next) => {
    await headers(context, next);

    // Routes may explicitly opt into a safe caching policy when appropriate.
    if (!context.res.headers.has("cache-control")) {
      context.res.headers.set("cache-control", "no-store");
    }
  };
};

const isUnsafeMethod = (method: string) => !SAFE_METHODS.has(method.toUpperCase());

const isFormLikeContentType = (contentType: string | undefined) => {
  // Hono's CSRF middleware treats an absent Content-Type as text/plain. This
  // closes the same simple-request bypass while still allowing safe methods.
  const mediaType = (contentType ?? "text/plain").split(";", 1)[0]?.trim().toLowerCase();

  return mediaType !== undefined && FORM_CONTENT_TYPES.has(mediaType);
};

const createCsrfErrorResponse = (env: ApiEnv, path: string, requestId?: string) =>
  createErrorResponse(
    env,
    StatusCodes.FORBIDDEN,
    "CSRF_VALIDATION_FAILED",
    `CSRF protection rejected request at ${path}`,
    "Request failed CSRF validation.",
    path,
    requestId,
  );

export const createCsrfProtection = (env: ApiEnv): ApiMiddleware => {
  return async (context, next) => {
    if (
      !isUnsafeMethod(context.req.method) ||
      !isFormLikeContentType(context.req.header("content-type"))
    ) {
      return next();
    }

    const secFetchSite = context.req.header("sec-fetch-site")?.toLowerCase();
    const origin = context.req.header("origin");
    const requestOrigin = new URL(context.req.url).origin;

    // Fetch Metadata is the primary browser-controlled signal. Unknown values
    // are ignored for forward compatibility and fall back to Origin checking.
    const hasValidSecFetchSite =
      secFetchSite !== undefined && VALID_SEC_FETCH_SITES.has(secFetchSite);
    const requestAllowed = hasValidSecFetchSite
      ? secFetchSite === "same-origin"
      : origin !== undefined && origin === requestOrigin;

    if (!requestAllowed) {
      const error = createCsrfErrorResponse(
        env,
        context.req.path,
        context.get(REQUEST_ID_CONTEXT_KEY),
      );

      return context.json(error, StatusCodes.FORBIDDEN, {
        "content-type": PROBLEM_JSON_CONTENT_TYPE,
      });
    }

    return next();
  };
};

export const createRequestBodyLimit = (env: ApiEnv): ApiMiddleware =>
  bodyLimit({
    maxSize: MAX_REQUEST_BODY_SIZE,
    onError: (context) => {
      const error = createErrorResponse(
        env,
        StatusCodes.REQUEST_TOO_LONG,
        "REQUEST_BODY_TOO_LARGE",
        `Request body exceeded size limit at ${context.req.path}`,
        "Request body is too large.",
        context.req.path,
        context.get(REQUEST_ID_CONTEXT_KEY),
      );

      return context.json(error, StatusCodes.REQUEST_TOO_LONG, {
        "content-type": PROBLEM_JSON_CONTENT_TYPE,
      });
    },
  });

export const createSecurityMiddleware = (env: ApiEnv): ApiMiddleware[] => [
  createSecurityHeaders(env),
  createRequestBodyLimit(env),
];
