import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("./run-with-env.mjs", import.meta.url));
const subprocessEnvironment = { ...process.env };
Reflect.deleteProperty(subprocessEnvironment, "NODE_TEST_CONTEXT");

function killProcessGroupIfRunning(processId) {
  if (!Number.isSafeInteger(processId)) {
    return;
  }

  try {
    process.kill(-processId, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
}

test("derives and encodes the local database URL", () => {
  const result = spawnSync(
    process.execPath,
    [script, process.execPath, "-e", "process.stdout.write(process.env.DATABASE_URL ?? '')"],
    {
      encoding: "utf8",
      env: {
        ...subprocessEnvironment,
        DATABASE_URL: "",
        POSTGRES_DB: "database/name",
        POSTGRES_PASSWORD: "password@with:special/characters#",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "local@user",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    "postgresql://local%40user:password%40with%3Aspecial%2Fcharacters%23@localhost:5433/database%2Fname",
  );
});

test(
  "forwards termination signals to the child process group",
  { skip: process.platform === "win32", timeout: 5_000 },
  async () => {
    const childProgram = [
      'process.on("SIGTERM", () => {',
      '  process.stdout.write("terminated\\n", () => process.exit(0));',
      "});",
      "console.log(`ready:${process.pid}`);",
      "setInterval(() => {}, 1_000);",
    ].join("\n");
    const wrapper = spawn(process.execPath, [script, process.execPath, "-e", childProgram], {
      env: subprocessEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    wrapper.stdout.setEncoding("utf8");
    wrapper.stderr.setEncoding("utf8");
    wrapper.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });
    await new Promise((resolve, reject) => {
      wrapper.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("ready:")) {
          resolve();
        }
      });
      wrapper.on("exit", (code, signal) => {
        reject(
          new Error(
            `Wrapper exited before its child was ready (code=${code}, signal=${signal}): ${errorOutput}`,
          ),
        );
      });
    });

    const childPid = Number.parseInt(output.match(/ready:(\d+)/u)?.[1] ?? "", 10);
    const exit = once(wrapper, "exit");
    try {
      wrapper.kill("SIGTERM");
      const [code, signal] = await exit;

      assert.equal(code, null);
      assert.equal(signal, "SIGTERM");
      assert.match(output, /terminated/u);
    } finally {
      if (wrapper.exitCode === null && wrapper.signalCode === null) {
        wrapper.kill("SIGKILL");
      }
      killProcessGroupIfRunning(childPid);
    }
  },
);
