/**
 * Vite config for the dashboard UI. Source lives in `web/`, output is emitted
 * to `dist/web/` so that the CLI's `serve` subcommand can find it next to
 * `dist/cli.js` after a single `pnpm build`.
 *
 * In dev mode (`pnpm dev:web`), Vite proxies `/api` to the CLI's HTTP server
 * — start that with `pnpm dev -- serve --no-open --no-ui` so the API is
 * available while HMR runs.
 */

import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const ROOT = path.resolve(__dirname, "web");
const API_PROXY_TARGET = process.env.MCPI_API ?? "http://127.0.0.1:8765";

export default defineConfig({
  root: ROOT,
  publicDir: path.join(ROOT, "public"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.join(ROOT, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": { target: API_PROXY_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/web"),
    emptyOutDir: true,
  },
});
