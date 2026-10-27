import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    version: { type: "string" },
    series: { type: "string", default: "all" },
    revision: { type: "string", default: "1" },
    maintainer: { type: "string" },
    output: { type: "string", default: "release/ppa" },
    "orig-tarball": { type: "string" },
    help: { type: "boolean" },
  },
});

if (values.help) {
  console.log("Usage: node scripts/prepare-ppa.mjs --version 1.8.2 [--series all|jammy,noble,resolute,stonking] [--revision 1] [--maintainer 'Name <email>'] [--output release/ppa] [--orig-tarball PATH]");
  process.exit(0);
}

assert.equal(process.platform, "linux", "Prepare the PPA source package on Linux");
assert.equal(process.arch, "x64", "Prepare the PPA source package on amd64");
assert.match(values.version ?? "", /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "Supply a stable release with --version");
assert.match(values.revision, /^[1-9]\d*$/, "Revision must be a positive integer");
const ppa = JSON.parse(readFileSync("debian/ppa.json", "utf8"));
const selected = values.series === "all" ? ppa.series.map((target) => target.name) : values.series.split(",");
assert.ok(selected.length && new Set(selected).size === selected.length, "Select unique Ubuntu series");
const targets = selected.map((series) => {
  const target = ppa.series.find((candidate) => candidate.name === series);
  assert.ok(target, `Unsupported Ubuntu series: ${series}`);
  return target;
});

const maintainer = values.maintainer ?? "Laszlo Stahorszki <rolaca12@gmail.com>";
assert.match(maintainer, /^[^<>\r\n]+ <[^<>\s]+@[^<>\s]+>$/, "Use --maintainer 'Name <email>'");
const output = path.resolve(values.output);
const name = `mcp-inspector-${values.version}`;
const source = path.join(output, name);
const tarball = path.join(output, `mcp-inspector_${values.version}.orig.tar.xz`);
assert.ok(!existsSync(source) && !existsSync(tarball), "Output already exists; choose an empty --output directory");
mkdirSync(source, { recursive: true });

if (values["orig-tarball"]) {
  const original = path.resolve(values["orig-tarball"]);
  assert.equal(path.basename(original), path.basename(tarball), "The original tarball must match --version");
  cpSync(original, tarball);
  execFileSync("tar", ["-xJf", tarball, "-C", output, "--no-same-owner"], { stdio: "inherit" });
  assert.equal(JSON.parse(readFileSync(path.join(source, "package.json"), "utf8")).version, values.version);
} else {
  const tracked = execFileSync("git", ["ls-files", "-z", "--",
    "package.json", "bun.lock", "tsconfig.json", "LICENSE", "README.md", "packages", "scripts", "docs",
  ], { encoding: "utf8" }).split("\0").filter(Boolean);
  for (const entry of new Set([...tracked, "scripts/prepare-ppa.mjs", "scripts/build-ppa.mjs", "scripts/upload-ppa.mjs", "packages/electron/build/relocate-deb.cjs", "docs/ppa.md"])) {
    if (!existsSync(entry)) continue;
    const target = path.join(source, entry);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(entry, target);
  }

  execFileSync("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], { cwd: source, stdio: "inherit" });

  for (const file of ["package.json", ...readdirSync(path.join(source, "packages")).map((workspace) => `packages/${workspace}/package.json`)]) {
    const target = path.join(source, file);
    const metadata = JSON.parse(readFileSync(target, "utf8"));
    metadata.version = values.version;
    writeFileSync(target, `${JSON.stringify(metadata, null, 2)}\n`);
  }
  execFileSync(process.execPath, ["scripts/sync-lockfile-versions.mjs"], { cwd: source, stdio: "inherit" });

  const electronRequire = createRequire(realpathSync(path.join(source, "packages/electron/node_modules/electron/package.json")));
  const electronVersion = electronRequire("./package.json").version;
  const { downloadArtifact } = electronRequire("@electron/get");
  const archive = await downloadArtifact({ version: electronVersion, artifactName: "electron", platform: "linux", arch: "x64" });
  const runtime = path.join(source, "vendor/electron");
  mkdirSync(runtime, { recursive: true });
  execFileSync("unzip", ["-q", archive, "-d", runtime], { stdio: "inherit" });
  writeFileSync(path.join(source, "vendor/provenance.json"), `${JSON.stringify({
    electron: {
      version: electronVersion,
      url: `https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-linux-x64.zip`,
    },
    bun: execFileSync("bun", ["--version"], { encoding: "utf8" }).trim(),
  }, null, 2)}\n`);

  const epoch = execFileSync("git", ["log", "-1", "--format=%ct"], { encoding: "utf8" }).trim();
  execFileSync("tar", [
    "--sort=name", `--mtime=@${epoch}`, "--owner=0", "--group=0", "--numeric-owner",
    "-cJf", tarball, "-C", output, name,
  ], { stdio: "inherit", env: { ...process.env, XZ_OPT: process.env.XZ_OPT ?? "-T2" } });
}

cpSync("debian", path.join(source, "debian"), { recursive: true });
if (values["orig-tarball"]) {
  let patch = "";
  for (const file of ["packages/electron/build/mcp-inspector", "scripts/verify-deb.mjs"]) {
    const result = spawnSync("diff", ["-u", "--label", `a/${file}`, "--label", `b/${file}`, path.join(source, file), file], { encoding: "utf8" });
    assert.ok(result.status === 0 || result.status === 1, result.stderr || `Could not compare ${file}`);
    patch += result.stdout;
  }
  if (patch) {
    const patches = path.join(source, "debian/patches");
    mkdirSync(patches, { recursive: true });
    writeFileSync(path.join(patches, "installation-paths.patch"), patch);
    const series = path.join(patches, "series");
    writeFileSync(series, `${existsSync(series) ? readFileSync(series, "utf8").trimEnd() + "\n" : ""}installation-paths.patch\n`);
  }
}
const control = path.join(source, "debian/control");
writeFileSync(control, readFileSync(control, "utf8").replace(/^Maintainer: .*$/m, `Maintainer: ${maintainer}`));
const epoch = execFileSync("git", ["log", "-1", "--format=%ct"], { encoding: "utf8" }).trim();
const date = new Date(Number(epoch) * 1000).toUTCString().replace("GMT", "+0000");
const uploads = [];
for (const target of targets) {
  const version = `${values.version}-0ubuntu${values.revision}~${target.version}.1`;
  writeFileSync(path.join(source, "debian/changelog"), `mcp-inspector (${version}) ${target.name}; urgency=medium\n\n  * Package MCP Inspector ${values.version} for ${target.name}.\n\n -- ${maintainer}  ${date}\n`);
  execFileSync("dpkg-buildpackage", ["-S", values["orig-tarball"] ? "-sd" : "-sa", "-us", "-uc", "-d"], { cwd: source, stdio: "inherit" });
  const changes = `mcp-inspector_${version}_source.changes`;
  uploads.push({ series: target.name, ubuntu: target.version, version, changes });
  console.log(`Unsigned source package: ${path.join(output, changes)}`);
}
writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify({
  ppa: `ppa:${ppa.owner}/${ppa.name}`,
  architectures: ppa.architectures,
  uploads,
}, null, 2)}\n`);
console.log(`\nPrepared ${uploads.length} source uploads for ppa:${ppa.owner}/${ppa.name}`);
