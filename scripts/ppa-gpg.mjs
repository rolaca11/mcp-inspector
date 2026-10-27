import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function cleanup(directory) {
  if (!directory) return;
  assert.ok(path.basename(directory).startsWith("mcp-inspector-ppa-gpg-"));
  assert.ok(existsSync(path.join(directory, ".mcp-ppa-ci")));
  execFileSync("gpgconf", ["--homedir", path.join(directory, "gnupg"), "--kill", "gpg-agent"]);
  rmSync(directory, { recursive: true, force: true });
}

if (process.argv[2] === "cleanup") {
  cleanup(process.env.PPA_GPG_CREDENTIALS_DIRECTORY);
} else {
  assert.equal(process.argv[2], "setup", "Usage: node scripts/ppa-gpg.mjs setup|cleanup");
  assert.ok(process.env.PPA_GPG_PRIVATE_KEY, "PPA_GPG_PRIVATE_KEY is required");
  assert.ok(process.env.GITHUB_ENV, "GITHUB_ENV is required");
  const ppa = JSON.parse(readFileSync("debian/ppa.json", "utf8"));
  const key = process.env.PPA_GPG_FINGERPRINT ?? ppa.signingKey;
  assert.match(key ?? "", /^(?:[0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$/);
  const directory = mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), "mcp-inspector-ppa-gpg-"));
  const home = path.join(directory, "gnupg");
  const passphrase = path.join(directory, "passphrase");
  mkdirSync(home, { mode: 0o700 });
  writeFileSync(path.join(directory, ".mcp-ppa-ci"), "");
  writeFileSync(passphrase, process.env.PPA_GPG_PASSPHRASE ?? "", { mode: 0o600 });
  const env = { ...process.env, GNUPGHOME: home };
  delete env.PPA_GPG_PRIVATE_KEY;
  delete env.PPA_GPG_PASSPHRASE;
  try {
    execFileSync("gpg", ["--batch", "--import"], { env, input: process.env.PPA_GPG_PRIVATE_KEY });
    execFileSync("gpg", ["--batch", "--list-secret-keys", key], { env });
    const signature = path.join(directory, "probe.asc");
    const probe = "MCP Inspector PPA CI signing check\n";
    execFileSync("gpg", ["--batch", "--pinentry-mode", "loopback", "--passphrase-file", passphrase, "--local-user", key, "--armor", "--detach-sign", "--output", signature], { env, input: probe });
    execFileSync("gpg", ["--batch", "--verify", signature, "-"], { env, input: probe });
    appendFileSync(process.env.GITHUB_ENV, `GNUPGHOME=${home}\nPPA_GPG_PASSPHRASE_FILE=${passphrase}\nPPA_GPG_CREDENTIALS_DIRECTORY=${directory}\n`);
    console.log(`PPA signing key ${key} is ready.`);
  } catch (error) {
    cleanup(directory);
    throw error;
  }
}
