import type { MiddlewareHandler } from "hono";

import { type AppVariables, REQUEST_ID_CONTEXT_KEY } from "../lib/context.js";

const REQUEST_ID_HEADER = "x-request-id";

const getRequestId = (headerValue: string | undefined) => {
  if (headerValue && headerValue.trim().length > 0) {
    return headerValue.trim();
  }

  return crypto.randomUUID();
};

export function createRequestIdMiddleware() {
  const requestIdMiddleware: MiddlewareHandler<{
    Variables: AppVariables;
  }> = async (context, next) => {
    const requestId = getRequestId(context.req.header(REQUEST_ID_HEADER));

    context.set(REQUEST_ID_CONTEXT_KEY, requestId);

    await next();

    context.res.headers.set(REQUEST_ID_HEADER, requestId);
  };

  return requestIdMiddleware;
}
