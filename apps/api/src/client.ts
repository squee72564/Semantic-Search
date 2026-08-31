import { hc } from "hono/client";

import type { AppType } from "./app.js";

export function createApiClient(...args: Parameters<typeof hc<AppType>>) {
  return hc<AppType>(...args);
}

export type ApiClient = ReturnType<typeof createApiClient>;
