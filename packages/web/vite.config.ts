import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API_PROXY_TARGET = process.env.MCPI_API ?? "http://127.0.0.1:8765";

export default defineConfig({
  define: {
    __PKG_VERSION__: JSON.stringify(
      process.env.npm_package_version ?? "0.0.0-dev",
    ),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
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
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
