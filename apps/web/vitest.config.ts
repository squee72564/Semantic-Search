import baseConfig from "@repo/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      tsconfigPaths: true,
    },
    test: {
      environment: "jsdom",
      include: ["app/**/*.test.{ts,tsx}"],
      setupFiles: ["./app/test-setup.ts"],
    },
  }),
);
