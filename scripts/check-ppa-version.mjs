import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publishedVersions } from "./ppa-published.mjs";

const version = process.argv[2];
assert.match(version ?? "", /^\d+\.\d+\.\d+$/, "Supply a stable release version");
const ppa = JSON.parse(readFileSync("debian/ppa.json", "utf8"));
const versions = await publishedVersions(ppa);
assert.ok(![...versions].some((published) => published.startsWith(`${version}-`)), `PPA version ${version} already exists. Choose a new release version, or prepare a packaging revision with the accepted original tarball.`);
console.log(`PPA version ${version} is available.`);
