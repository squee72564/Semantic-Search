import { createApiClient } from "@repo/api/client";
import { readWebServerEnv } from "@repo/env/web";

export function createServerApiClient(request: Request) {
  const { API_INTERNAL_URL } = readWebServerEnv();
  const cookie = request.headers.get("cookie");

  return createApiClient(
    API_INTERNAL_URL,
    cookie
      ? {
          headers: { cookie },
        }
      : undefined,
  );
}
