import type { Session, User } from "better-auth";
import type { Context, MiddlewareHandler } from "hono";
import { StatusCodes } from "http-status-codes";

import { type AppVariables, CURRENT_USER_CONTEXT_KEY, SESSION_CONTEXT_KEY } from "./context.js";
import { ApiError } from "./error.js";

export interface ApiAuthentication {
  api: {
    getSession: (input: { headers: Headers }) => Promise<{
      session: Session;
      user: User;
    } | null>;
  };
  handler: (request: Request) => Promise<Response> | Response;
}

type AuthenticationSession = Awaited<ReturnType<ApiAuthentication["api"]["getSession"]>>;

function applyAuthSession(
  context: Context<{ Variables: AppVariables }, string, object>,
  authSession: AuthenticationSession,
) {
  context.set(SESSION_CONTEXT_KEY, authSession?.session ?? null);
  context.set(CURRENT_USER_CONTEXT_KEY, authSession?.user ?? null);
}

export function getAuthenticatedUser(
  context: Context<{ Variables: AppVariables }, string, object>,
): User {
  const user = context.get(CURRENT_USER_CONTEXT_KEY);

  if (!user) {
    throw new ApiError({
      code: "UNAUTHENTICATED",
      expose: true,
      message: "No authenticated user in request context",
      status: StatusCodes.UNAUTHORIZED,
      title: "Unauthorized",
      userMessage: "Authentication is required.",
    });
  }

  return user;
}

export function createAuthenticationMiddleware({ auth }: { auth: ApiAuthentication }) {
  const getAuthSession = (request: Request) => auth.api.getSession({ headers: request.headers });

  return {
    optionalAuth: (): MiddlewareHandler<{ Variables: AppVariables }> => async (context, next) => {
      const authSession = await getAuthSession(context.req.raw);
      applyAuthSession(context, authSession);
      await next();
    },

    requireAuth: (): MiddlewareHandler<{ Variables: AppVariables }> => async (context, next) => {
      const authSession = await getAuthSession(context.req.raw);

      if (!authSession) {
        throw new ApiError({
          code: "UNAUTHENTICATED",
          expose: true,
          message: "No valid session for request",
          status: StatusCodes.UNAUTHORIZED,
          title: "Unauthorized",
          userMessage: "Authentication is required.",
        });
      }

      applyAuthSession(context, authSession);
      await next();
    },
  };
}
