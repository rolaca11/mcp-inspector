import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    // core's version.ts reads this; keep it on the fast path during tests.
    __PKG_VERSION__: JSON.stringify("0.0.0-test"),
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
