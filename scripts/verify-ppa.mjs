import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    output: { type: "string", default: "release/ppa" },
    series: { type: "string", default: "all" },
    engine: { type: "string", default: "docker" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log("Usage: node scripts/verify-ppa.mjs [--output release/ppa] [--series all|jammy] [--engine docker|podman]");
  process.exit(0);
}
assert.ok(["docker", "podman"].includes(values.engine), "Choose docker or podman");
const output = path.resolve(values.output);
const manifest = JSON.parse(readFileSync(path.join(output, "manifest.json"), "utf8"));
const ppa = JSON.parse(readFileSync("debian/ppa.json", "utf8"));
assert.equal(manifest.ppa, `ppa:${ppa.owner}/${ppa.name}`);
const targets = manifest.uploads.filter((upload) => values.series === "all" || upload.series === values.series);
assert.ok(targets.length, "No matching Ubuntu series in the manifest");
for (const target of targets) {
  const configured = ppa.series.find((entry) => entry.name === target.series);
  assert.ok(configured, "Unsupported Ubuntu series");
  assert.equal(target.ubuntu, configured.version);
  assert.match(target.version, /^\d+\.\d+\.\d+-0ubuntu\d+~\d+\.\d+\.\d+$/);
  const image = `mcp-inspector-ppa-${target.series}`;
  execFileSync(values.engine, ["build", "--build-arg", `UBUNTU_VERSION=${target.ubuntu}`, "-t", image, "-f", path.resolve("debian/tests/Containerfile"), path.resolve("debian")], { stdio: "inherit" });
  const container = ["run", "--rm", "--network", "none"];
  if (values.engine === "podman") container.push("--userns", "keep-id");
  container.push("--user", `${process.getuid()}:${process.getgid()}`, "-v", `${output}:/build`, "-w", "/build", image, "sh", "-ec", `
! command -v node
! command -v bun
! command -v npm
dpkg-source -x "mcp-inspector_\${1}.dsc" "verify-\${2}"
cd "verify-\${2}"
dpkg-buildpackage -b -us -uc
ELECTRON_RUN_AS_NODE=1 vendor/electron/electron scripts/verify-deb.mjs "../mcp-inspector_\${1}_amd64.deb"
`, "sh", target.version, target.series);
  execFileSync(values.engine, container, { stdio: "inherit" });
  writeFileSync(path.join(output, `verification-${target.series}.json`), `${JSON.stringify({ series: target.series, ubuntu: target.ubuntu, version: target.version, offline_build: true, smoke_checks: true }, null, 2)}\n`);
}
