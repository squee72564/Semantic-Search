import baseConfig from "@repo/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      environment: "node",
    },
  }),
);
