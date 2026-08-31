import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    client: "src/client.ts",
    index: "src/index.ts",
  },
  clean: true,
  deps: {
    alwaysBundle: (id, importer) =>
      /^@repo\/(?:auth|db|env)(?:\/|$)/u.test(id) && !/\.d\.[cm]?ts$/u.test(importer ?? ""),
    dts: {
      neverBundle: true,
    },
    onlyBundle: ["drizzle-orm", "postgres"],
  },
  dts: true,
  fixedExtension: false,
  format: "esm",
  outDir: "dist",
  platform: "node",
  sourcemap: true,
  target: "node24",
});
