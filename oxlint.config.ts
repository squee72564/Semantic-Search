import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "error",
    suspicious: "warn",
    perf: "warn",
  },
  plugins: [
    "eslint",
    "typescript",
    "react",
    "react-perf",
    "jsx-a11y",
    "import",
    "unicorn",
    "vitest",
    "oxc",
  ],
  env: {
    browser: true,
    node: true,
  },
  ignorePatterns: [
    "**/build/**",
    "**/coverage/**",
    "**/dist/**",
    "**/drizzle/**",
    "**/app/components/ui/**",
    "**/node_modules/**",
    "**/.react-router/**",
    "**/.turbo/**",
  ],
  rules: {
    "import/no-unassigned-import": "off",
    "react/react-in-jsx-scope": "off",
  },
  overrides: [
    {
      files: ["**/*.test.{ts,tsx}"],
      env: {
        browser: true,
        node: true,
      },
    },
  ],
});
