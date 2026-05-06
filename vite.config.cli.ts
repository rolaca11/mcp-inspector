import { defineConfig } from "vite";

export default defineConfig({
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
