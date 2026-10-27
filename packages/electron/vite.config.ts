import { defineConfig } from "vite";
import cliPackage from "../cli/package.json";
import electronPackage from "./package.json";

const runtimeDependencies: Record<string, string> = electronPackage.dependencies;
for (const [name, range] of Object.entries(cliPackage.dependencies)) {
  if (runtimeDependencies[name] !== range) {
    throw new Error(`Electron dependency ${name} must match CLI range ${range}`);
  }
}

export default defineConfig({
  define: {
    __PKG_VERSION__: JSON.stringify(
      process.env.npm_package_version ?? "0.0.0-dev",
    ),
    "process.env": "process.env",
  },
  build: {
    lib: {
      entry: {
        main: "src/main.ts",
        preload: "src/preload.ts",
        cli: "src/cli.ts",
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: (id) =>
        id === "electron" ||
        (/^[^./]/.test(id) && !id.startsWith("@rolaca11/mcp-inspector-core")),
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name]-[hash].js",
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
