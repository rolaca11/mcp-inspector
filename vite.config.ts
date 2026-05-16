/**
 * Vite config for the dashboard UI. Source lives in `src/web/`, output is
 * emitted to `dist/web/` so that the CLI's `serve` subcommand can find it
 * next to `dist/cli.js` after a single `bun run build`.
 *
 * In dev mode (`bun run dev:ui`), Vite proxies `/api/trpc` to the CLI's HTTP server
 * — start that with `bun run dev:cli -- serve --no-open --no-ui` so the API is
 * available while HMR runs.
 */

import path from "node:path";
import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const require = createRequire(import.meta.url);
const pkg = require("./package.json") as { version: string };
const API_PROXY_TARGET = process.env.MCPI_API ?? "http://127.0.0.1:8765";

export default defineConfig({
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/web"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api/trpc": { target: API_PROXY_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/web"),
    emptyOutDir: true,
  },
});
