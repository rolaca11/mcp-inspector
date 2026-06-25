// Generates `dist/package.json` for a publishable workspace library, then copies
// README/LICENSE alongside it. Run from a package directory after the bundler
// has emitted `dist/` (e.g. `tsup && node ../../scripts/write-dist-pkg.mjs`).
//
// Why: the workspace `package.json` keeps its `exports` pointing at `./src/*.ts`
// so the monorepo's dev/test/build all resolve TypeScript source with no build
// step. npm (unlike pnpm) does NOT apply `publishConfig` field overrides, so we
// publish the built `dist/` folder with its own manifest whose `exports` point
// at the emitted `./*.js` + `./*.d.ts`. `workspace:` dependency ranges are
// rewritten to real semver so external installs resolve from the registry.

import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const pkgDir = process.cwd();
const distDir = join(pkgDir, "dist");
if (!existsSync(distDir)) {
  console.error(`write-dist-pkg: ${distDir} is missing — run the build first`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

// Map every workspace package name -> version, to resolve `workspace:` deps.
const root = resolve(pkgDir, "../..");
const packagesDir = join(root, "packages");
const workspaceVersions = {};
for (const entry of readdirSync(packagesDir)) {
  const manifest = join(packagesDir, entry, "package.json");
  if (existsSync(manifest)) {
    const j = JSON.parse(readFileSync(manifest, "utf8"));
    if (j.name) workspaceVersions[j.name] = j.version;
  }
}

function resolveDeps(deps) {
  if (!deps) return undefined;
  const out = {};
  for (const [name, range] of Object.entries(deps)) {
    if (typeof range === "string" && range.startsWith("workspace:")) {
      const version = workspaceVersions[name];
      if (!version) throw new Error(`cannot resolve workspace dependency ${name}`);
      const spec = range.slice("workspace:".length);
      out[name] =
        spec === "*" || spec === "^" || spec === ""
          ? `^${version}`
          : spec === "~"
            ? `~${version}`
            : spec; // an explicit range like "workspace:1.2.3"
    } else {
      out[name] = range;
    }
  }
  return out;
}

// "./src/client.ts" -> { types: "./client.d.ts", import/default: "./client.js" }
function transformTarget(value) {
  if (typeof value !== "string") return value;
  const base = value.replace(/^\.\/src\//, "./").replace(/\.ts$/, "");
  return { types: `${base}.d.ts`, import: `${base}.js`, default: `${base}.js` };
}

// Only publish an export whose emitted `.js` actually exists in dist. This
// drops entries the build deliberately skipped (e.g. core's `./trpc/*`, which
// is consumed only from workspace source and never shipped).
function transformExports(exp) {
  const out = {};
  for (const [key, value] of Object.entries(exp)) {
    const target = transformTarget(value);
    const jsRel = typeof target === "string" ? target : target.default;
    if (jsRel && !existsSync(join(distDir, jsRel))) {
      console.log(`write-dist-pkg: skipping export "${key}" (no ${jsRel} in dist)`);
      continue;
    }
    out[key] = target;
  }
  return out;
}

const dependencies = resolveDeps(pkg.dependencies);
const distPkg = {
  name: pkg.name,
  version: pkg.version,
  ...(pkg.description ? { description: pkg.description } : {}),
  type: pkg.type ?? "module",
  ...(pkg.license ? { license: pkg.license } : {}),
  ...(pkg.author ? { author: pkg.author } : {}),
  ...(pkg.homepage ? { homepage: pkg.homepage } : {}),
  ...(pkg.repository ? { repository: pkg.repository } : {}),
  ...(pkg.keywords ? { keywords: pkg.keywords } : {}),
  ...(pkg.engines ? { engines: pkg.engines } : {}),
  ...(pkg.bin ? { bin: pkg.bin } : {}),
  ...(pkg.exports ? { exports: transformExports(pkg.exports) } : {}),
  ...(dependencies ? { dependencies } : {}),
  ...(pkg.peerDependencies ? { peerDependencies: pkg.peerDependencies } : {}),
  ...(pkg.peerDependenciesMeta ? { peerDependenciesMeta: pkg.peerDependenciesMeta } : {}),
  private: false,
  publishConfig: { access: "public" },
};

writeFileSync(join(distDir, "package.json"), JSON.stringify(distPkg, null, 2) + "\n");

for (const file of ["README.md", "LICENSE"]) {
  const src = join(pkgDir, file);
  if (existsSync(src)) copyFileSync(src, join(distDir, file));
}
if (!existsSync(join(distDir, "LICENSE")) && existsSync(join(root, "LICENSE"))) {
  copyFileSync(join(root, "LICENSE"), join(distDir, "LICENSE"));
}

console.log(`write-dist-pkg: wrote ${pkg.name} -> dist/package.json`);
