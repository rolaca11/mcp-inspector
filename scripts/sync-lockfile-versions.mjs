import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const lockfilePath = "bun.lock";
let lockfile = readFileSync(lockfilePath, "utf8");

for (const entry of readdirSync("packages", { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const packagePath = path.join("packages", entry.name, "package.json");
  if (!existsSync(packagePath)) continue;

  const { version } = JSON.parse(readFileSync(packagePath, "utf8"));
  const marker = `    "packages/${entry.name}": {`;
  const start = lockfile.indexOf(marker);
  const end = lockfile.indexOf("\n    },", start);
  if (start < 0 || end < 0) throw new Error(`Missing workspace in ${lockfilePath}: ${entry.name}`);

  const block = lockfile.slice(start, end);
  const updated = block.replace(/"version": "[^"]+"/, `"version": "${version}"`);
  if (updated === block && !block.includes(`"version": "${version}"`)) {
    throw new Error(`Missing version in ${lockfilePath}: ${entry.name}`);
  }
  lockfile = lockfile.slice(0, start) + updated + lockfile.slice(end);
}

writeFileSync(lockfilePath, lockfile);
