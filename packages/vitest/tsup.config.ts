import { defineConfig } from "tsup";

// Two entry points mirroring the package exports: the primitives (index) and
// the side-effecting matcher installer (setup). `@rolaca11/mcp-inspector-core`,
// `@modelcontextprotocol/sdk`, and `vitest` are declared as deps/peers and so
// stay external automatically.
export default defineConfig({
  entry: { index: "src/index.ts", setup: "src/setup.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node18",
  sourcemap: true,
});
