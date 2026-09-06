import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createConnection, type Socket } from "node:net";
import * as schema from "../../schema/index.js";
import type { RepositoryFactory } from "../index.js";
import type { Connection, PostgresConnectionOptions } from "./contracts.js";

/** Owns one client and its sockets so forced retirement cannot affect another phase. */
export function createPostgresConnection<T>(
  databaseUrl: string,
  factory: RepositoryFactory<T>,
  options: PostgresConnectionOptions,
): Connection<T> {
  const { connectTimeoutMs, statementTimeoutMs, lockTimeoutMs } = options;
  const sockets = new Set<Socket>();
  let closed = false;
  let hostIndex = 0;
  // Postgres.js documents custom sockets, but 3.4.x omits this option from its types.
  // Owning the underlying socket also lets us terminate TLS connections without
  // relying on end(), which only half-closes a busy connection in this driver.
  const clientOptions = {
    max: 1,
    prepare: false,
    connect_timeout: connectTimeoutMs / 1000,
    socket: async (configuration: { host: string[]; port: number[]; path?: string }) => {
      if (closed) throw new Error("Upload database client is closed");
      const index = hostIndex++ % configuration.host.length;
      const host = configuration.host[index];
      const port = configuration.port[index % configuration.port.length];
      if (!host || !port) throw new Error("Database host and port are required");
      const socket = Object.assign(
        configuration.path
          ? createConnection(configuration.path)
          : createConnection({ host, port }),
        { host, port },
      );
      for (const previous of sockets) if (previous.destroyed) sockets.delete(previous);
      sockets.add(socket);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.destroy(
            Object.assign(new Error("Database connection timed out"), {
              code: "CONNECT_TIMEOUT",
            }),
          );
        }, connectTimeoutMs);
        const failed = (error: Error) => {
          clearTimeout(timer);
          reject(error);
        };
        const disconnected = () => failed(new Error("Database socket closed during connection"));
        socket.once("error", failed);
        socket.once("close", disconnected);
        socket.once("connect", () => {
          clearTimeout(timer);
          socket.removeListener("error", failed);
          socket.removeListener("close", disconnected);
          resolve();
        });
      });
      return socket;
    },
    connection: {
      statement_timeout: statementTimeoutMs,
      lock_timeout: lockTimeoutMs,
      idle_in_transaction_session_timeout: options.phaseTimeoutMs ?? 30_000,
    },
  };
  const client = postgres(databaseUrl, clientOptions);
  const db = drizzle(client, { schema });
  return {
    read: (operation) => operation(factory(db)),
    transaction: (operation) => db.transaction((tx) => operation(factory(tx))),
    close: async (force) => {
      closed = true;
      try {
        await client.end({ timeout: force ? 0 : 2 });
      } finally {
        for (const socket of sockets) socket.destroy();
        sockets.clear();
      }
    },
  };
}
