import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema/index.js";

export function createDatabase(databaseUrl: string) {
  const sql = postgres(databaseUrl, {
    max: 25,
    prepare: false,
  });

  return {
    db: drizzle(sql, { schema }),
    close: () => sql.end(),
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DatabaseExecutor = Database | DatabaseTransaction;
export type ClosePostgresConnFn = ReturnType<typeof createDatabase>["close"];
