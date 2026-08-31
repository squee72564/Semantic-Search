import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    proxy: {
      // Better Auth's public base path must reach Hono unchanged.
      "/api/auth": {
        target: process.env.API_INTERNAL_URL ?? "http://localhost:3001",
        changeOrigin: true,
      },
      "/api": {
        target: process.env.API_INTERNAL_URL ?? "http://localhost:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/u, ""),
      },
    },
  },
});
