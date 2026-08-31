import { createDatabase } from "@repo/db";
import { readApiEnv } from "@repo/env/api";

import { createAuth } from "../src/index.js";

const env = readApiEnv();
const { db } = createDatabase(env.DATABASE_URL);

// Better Auth's CLI requires a concrete instance exported as `auth`.
// Runtime code should use the dependency-injected factory instead.
export const auth = createAuth({
  db,
  config: {
    baseUrl: env.BETTER_AUTH_URL,
    nodeEnv: env.NODE_ENV,
    secret: env.BETTER_AUTH_SECRET,
  },
});
