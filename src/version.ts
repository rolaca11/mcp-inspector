import { createRequire } from "node:module";

declare const __PKG_VERSION__: string | undefined;

export const VERSION: string =
  typeof __PKG_VERSION__ === "string"
    ? __PKG_VERSION__
    : (createRequire(import.meta.url)("../package.json") as { version: string })
        .version;
