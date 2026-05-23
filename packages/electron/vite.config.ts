import { defineConfig } from "vite";

export default defineConfig({
  define: {
    __PKG_VERSION__: JSON.stringify(
      process.env.npm_package_version ?? "0.0.0-dev",
    ),
    "process.env": "process.env",
  },
  build: {
    rollupOptions: {
      input: {
        main: "src/main.ts",
        preload: "src/preload.ts",
      },
      external: (id) =>
        id === "electron" ||
        (/^[^./]/.test(id) && !id.startsWith("@rolaca11/mcp-inspector-core")),
      output: {
        entryFileNames: "[name].js",
        format: "es",
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: "node20",
  },
});
