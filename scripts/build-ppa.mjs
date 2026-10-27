import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

assert.equal(process.platform, "linux", "PPA builds require Linux");
assert.equal(process.arch, "x64", "The PPA package currently supports amd64 only");
if (process.versions.electron) process.noAsar = true;
const runtime = path.resolve("vendor/electron");
assert.ok(existsSync(path.join(runtime, "electron")), "Run scripts/prepare-ppa.mjs first");
const { version } = JSON.parse(readFileSync("packages/electron/package.json", "utf8"));
const env = { ...process.env, npm_package_version: version, CSC_IDENTITY_AUTO_DISCOVERY: "false" };

for (const workspace of ["web", "electron"]) {
  execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
    cwd: `packages/${workspace}`,
    env,
    stdio: "inherit",
  });
}

const projectDir = path.resolve("packages/electron");
const require = createRequire(path.join(projectDir, "package.json"));
const { build, Platform, Arch } = require("electron-builder");
process.chdir(projectDir);
await build({
  projectDir,
  targets: Platform.LINUX.createTarget(["dir"], Arch.x64),
  publish: "never",
  config: { electronDist: runtime, npmRebuild: false },
});
