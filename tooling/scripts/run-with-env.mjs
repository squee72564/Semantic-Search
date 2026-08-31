import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

const rootEnvFile = new URL("../../.env", import.meta.url);

if (existsSync(rootEnvFile)) {
  loadEnvFile(rootEnvFile);
}

if (!process.env.DATABASE_URL) {
  const database = process.env.POSTGRES_DB;
  const password = process.env.POSTGRES_PASSWORD;
  const port = process.env.POSTGRES_PORT;
  const user = process.env.POSTGRES_USER;

  if (database && password && port && user) {
    const databaseUrl = new URL("postgresql://localhost");
    databaseUrl.username = user;
    databaseUrl.password = password;
    databaseUrl.port = port;
    databaseUrl.pathname = `/${encodeURIComponent(database)}`;
    process.env.DATABASE_URL = databaseUrl.href;
  }
}

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage: node tooling/scripts/run-with-env.mjs <command> [...args]");
  process.exitCode = 1;
} else {
  const child = spawn(command, args, {
    detached: process.platform !== "win32",
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  const terminationSignals = ["SIGHUP", "SIGINT", "SIGTERM"];
  let forwardedSignal;

  const forwardSignal = (signal) => {
    forwardedSignal ??= signal;

    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    try {
      if (process.platform === "win32") {
        const taskkill = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          stdio: "ignore",
          windowsHide: true,
        });
        taskkill.on("error", () => {
          try {
            child.kill(signal);
          } catch (error) {
            if (error?.code !== "ESRCH") {
              console.error(`Failed to forward ${signal} to ${command}.`, error);
            }
          }
        });
        taskkill.unref();
      } else {
        process.kill(-child.pid, signal);
      }
    } catch (error) {
      if (error?.code !== "ESRCH") {
        console.error(`Failed to forward ${signal} to ${command}.`, error);
      }
    }
  };

  const signalListeners = terminationSignals.map((signal) => {
    const listener = () => forwardSignal(signal);
    process.on(signal, listener);
    return [signal, listener];
  });

  const restoreDefaultSignalHandling = () => {
    for (const [signal, listener] of signalListeners) {
      process.off(signal, listener);
    }
  };

  child.on("error", (error) => {
    restoreDefaultSignalHandling();
    console.error(`Failed to start ${command}.`, error);
    process.exitCode = 1;
  });

  child.on("exit", (code, signal) => {
    restoreDefaultSignalHandling();

    const exitSignal = forwardedSignal ?? signal;
    if (exitSignal) {
      process.kill(process.pid, exitSignal);
      return;
    }

    process.exitCode = code ?? 1;
  });
}
