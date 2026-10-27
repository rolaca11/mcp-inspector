import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const version = process.argv[2];
assert.match(version ?? "", /^\d+\.\d+\.\d+$/, "Supply a stable release version");
const ppa = JSON.parse(readFileSync("debian/ppa.json", "utf8"));
const url = new URL(`https://api.launchpad.net/1.0/~${ppa.owner}/+archive/ubuntu/${ppa.name}`);
url.search = new URLSearchParams({ "ws.op": "getPublishedSources", source_name: "mcp-inspector", exact_match: "true", "ws.size": "100" });
let next = url;
while (next) {
  const response = await fetch(next, {
    headers: { "Cache-Control": "no-cache", "User-Agent": "mcp-inspector-release" },
    signal: AbortSignal.timeout(30000),
  });
  assert.ok(response.ok, `Could not check PPA versions: HTTP ${response.status}`);
  const sources = await response.json();
  assert.ok(Array.isArray(sources.entries), "Launchpad returned an invalid source listing");
  assert.ok(!sources.entries.some((source) => source.source_package_version.startsWith(`${version}-`)), `PPA version ${version} already exists. Choose a new release version, or prepare a packaging revision with the accepted original tarball.`);
  next = sources.next_collection_link;
}
console.log(`PPA version ${version} is available.`);
