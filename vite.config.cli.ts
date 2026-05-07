import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
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
      external: [/^[^./]/],
      output: {
        banner: "#!/usr/bin/env node",
        codeSplitting: false,
      },
    },
  },
});
