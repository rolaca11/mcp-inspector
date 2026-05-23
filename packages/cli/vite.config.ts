import { defineConfig } from "vite";

export default defineConfig({
  define: {
    __PKG_VERSION__: JSON.stringify(
      process.env.npm_package_version ?? "0.0.0-dev",
    ),
  },
  build: {
    lib: {
      entry: "src/cli.ts",
      formats: ["es"],
      fileName: "cli",
    },
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    target: "node20",
    rollupOptions: {
      external: (id) =>
        /^[^./]/.test(id) && !id.startsWith("@rolaca11/mcp-inspector-core"),
      output: {
        banner: "#!/usr/bin/env node",
        codeSplitting: false,
      },
    },
  },
});
