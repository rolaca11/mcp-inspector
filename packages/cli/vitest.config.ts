import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  define: {
    __PKG_VERSION__: JSON.stringify("0.0.0-test"),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/web"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
