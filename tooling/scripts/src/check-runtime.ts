const requiredNodeMajor = 24;
const requiredPnpmMajor = 11;
const nodeMajor = Number(process.versions.node.split(".")[0]);
const packageManager = process.env.npm_config_user_agent ?? "unknown";
const pnpmMajor = Number(/pnpm\/(\d+)/u.exec(packageManager)?.[1]);

if (nodeMajor !== requiredNodeMajor || pnpmMajor !== requiredPnpmMajor) {
  console.error(
    `Expected Node ${requiredNodeMajor}.x and pnpm ${requiredPnpmMajor}.x; received Node ${process.versions.node} and ${packageManager}.`,
  );
  process.exitCode = 1;
} else {
  console.log(`Runtime verified: Node ${process.versions.node}, ${packageManager.split(" ")[0]}.`);
}
