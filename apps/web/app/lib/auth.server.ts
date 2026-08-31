import type { AuthSession } from "@repo/auth/client";
import { readWebServerEnv } from "@repo/env/web";

type ServerSession = {
  session: Pick<AuthSession["session"], "id">;
  user: Pick<AuthSession["user"], "email" | "id" | "name">;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAuthSession(value: unknown): value is ServerSession {
  if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.session)) {
    return false;
  }

  return (
    typeof value.user.id === "string" &&
    typeof value.user.name === "string" &&
    typeof value.user.email === "string" &&
    typeof value.session.id === "string"
  );
}

export async function getServerSession(request: Request) {
  const { API_INTERNAL_URL } = readWebServerEnv();
  const requestHeaders = new Headers({ accept: "application/json" });
  const cookie = request.headers.get("cookie");

  if (cookie) {
    requestHeaders.set("cookie", cookie);
  }

  const response = await fetch(new URL("/api/auth/get-session", API_INTERNAL_URL), {
    headers: requestHeaders,
  });

  if (!response.ok) {
    throw new Response("The authentication service is unavailable.", { status: 502 });
  }

  const session: unknown = await response.json();

  if (session !== null && !isAuthSession(session)) {
    throw new Response("The authentication service returned an invalid response.", { status: 502 });
  }

  const responseHeaders = new Headers({ "cache-control": "private, no-store" });

  for (const setCookie of response.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", setCookie);
  }

  return { headers: responseHeaders, session };
}
