import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    key: { type: "string" },
    output: { type: "string", default: "release/ppa" },
    "dry-run": { type: "boolean" },
    batch: { type: "boolean" },
    "passphrase-file": { type: "string" },
    "sign-only": { type: "boolean" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log("Usage: node scripts/upload-ppa.mjs [--key SIGNING_FINGERPRINT] [--output release/ppa] [--batch --passphrase-file PATH] [--sign-only] [--dry-run]");
  process.exit(0);
}
const output = path.resolve(values.output);
const manifest = JSON.parse(readFileSync(path.join(output, "manifest.json"), "utf8"));
const ppa = JSON.parse(readFileSync("debian/ppa.json", "utf8"));
const key = values.key ?? ppa.signingKey;
assert.match(key ?? "", /^(?:[0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$/, "Supply the full signing key fingerprint with --key");
const destination = `ppa:${ppa.owner}/${ppa.name}`;
assert.equal(manifest.ppa, destination, "The manifest must target the configured PPA");
assert.ok(manifest.uploads.length, "No source uploads in the manifest");
for (const upload of manifest.uploads) {
  assert.equal(upload.changes, `mcp-inspector_${upload.version}_source.changes`);
  assert.ok(ppa.series.some((target) => target.name === upload.series), "Unsupported Ubuntu series");
  const file = path.join(output, upload.changes);
  assert.equal(path.dirname(file), output);
  assert.ok(existsSync(file), `Missing source changes: ${file}`);
  const changes = readFileSync(file, "utf8");
  assert.match(changes, /^Architecture: source$/m, "Only source uploads are allowed");
  assert.ok(changes.includes(`\nDistribution: ${upload.series}\n`), "Source distribution does not match the manifest");
}
let temporary;
const signingOptions = [];
const signingEnv = { ...process.env };
try {
  if (values.batch) {
    assert.ok(values["passphrase-file"], "Batch signing requires --passphrase-file");
    const passphrase = path.resolve(values["passphrase-file"]);
    assert.ok(existsSync(passphrase), "Passphrase file does not exist");
    temporary = mkdtempSync(path.join(tmpdir(), "mcp-inspector-ppa-sign-"));
    const program = path.join(temporary, "gpg");
    writeFileSync(program, '#!/bin/sh\nexec gpg --batch --pinentry-mode loopback --passphrase-file "$PPA_GPG_PASSPHRASE_FILE" "$@"\n', { mode: 0o700 });
    signingOptions.push("--no-conf", "--re-sign", `-p${program}`);
    signingEnv.PPA_GPG_PASSPHRASE_FILE = passphrase;
  }
  for (const upload of manifest.uploads) {
    const args = [...signingOptions, `-k${key}`, path.join(output, upload.changes)];
    if (values["dry-run"]) console.log("debsign", ...args);
    else execFileSync("debsign", args, { env: signingEnv, stdio: "inherit" });
  }
  if (!values["sign-only"]) {
    for (const upload of manifest.uploads) {
      const args = [destination, path.join(output, upload.changes)];
      if (values["dry-run"]) console.log("dput", ...args);
      else execFileSync("dput", args, { stdio: "inherit" });
    }
  }
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
