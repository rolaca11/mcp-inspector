import { readFileSync } from "node:fs";

import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as {
  version: string;
};

// Build every module under src/ (except tests) into dist/, mirroring the
// structure the `exports` map references. Runtime deps (the SDK, picocolors,
// open, …) stay external automatically. `__PKG_VERSION__` is inlined so the
// published `version.js` never falls back to reading package.json at runtime.
//
// `trpc/` is excluded: its tRPC router exposes a huge inferred type that can't
// emit a portable `.d.ts`, and it's app-internal plumbing consumed only by the
// dashboard/CLI via workspace *source* — never from the published package. The
// manifest generator drops the `./trpc/*` exports from the published dist since
// their files aren't emitted here.
export default defineConfig({
  entry: ["src/**/*.ts", "!src/**/*.test.ts", "!src/__tests__/**", "!src/trpc/**"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node18",
  sourcemap: true,
  define: { __PKG_VERSION__: JSON.stringify(version) },
});
