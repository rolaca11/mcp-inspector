import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = mkdtempSync(path.join(tmpdir(), "mcp-ppa-signing-test-"));
const home = path.join(root, "original-keyring");
const passphrase = "ppa-ci-test-passphrase";
let fingerprint;
let armored;

function gpg(args, options = {}) {
  return execFileSync("gpg", ["--batch", "--pinentry-mode", "loopback", "--passphrase", passphrase, ...args], {
    env: { ...process.env, GNUPGHOME: home },
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
}

before(() => {
  mkdirSync(home, { mode: 0o700 });
  gpg(["--quick-generate-key", "PPA CI test <ci@example.invalid>", "rsa2048", "cert", "1d"]);
  fingerprint = gpg(["--with-colons", "--list-secret-keys"]).split("\n").find((line) => line.startsWith("fpr:")).split(":")[9];
  gpg(["--quick-add-key", fingerprint, "rsa2048", "sign", "1d"]);
  const subkey = gpg(["--with-colons", "--list-secret-keys"]).split("\n").filter((line) => line.startsWith("fpr:")).at(-1).split(":")[9];
  armored = gpg(["--armor", "--export-secret-subkeys", `${subkey}!`]);
});

after(() => {
  execFileSync("gpgconf", ["--homedir", home, "--kill", "gpg-agent"]);
  rmSync(root, { recursive: true, force: true });
});

function environment(directory, password = passphrase) {
  const bin = path.join(directory, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "dput"), '#!/bin/sh\nprintf "Uploads are disabled in this test\\n" >&2\nexit 97\n', { mode: 0o755 });
  const environmentFile = path.join(directory, "github-env");
  writeFileSync(environmentFile, "");
  return {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    RUNNER_TEMP: directory,
    GITHUB_ENV: environmentFile,
    PPA_GPG_PRIVATE_KEY: armored,
    PPA_GPG_PASSPHRASE: password,
    PPA_GPG_FINGERPRINT: fingerprint,
  };
}

test("CI signs source metadata with an exported signing subkey and removes its credentials", { timeout: 120000 }, () => {
  const directory = path.join(root, "success");
  const env = environment(directory);
  execFileSync(process.execPath, ["scripts/ppa-gpg.mjs", "setup"], { cwd: repository, env, stdio: ["pipe", "pipe", "pipe"] });
  for (const line of readFileSync(env.GITHUB_ENV, "utf8").trim().split("\n")) {
    const separator = line.indexOf("=");
    env[line.slice(0, separator)] = line.slice(separator + 1);
  }
  try {
    const output = path.join(directory, "packages");
    const source = path.join(output, "source");
    mkdirSync(path.join(source, "debian/source"), { recursive: true });
    writeFileSync(path.join(source, "debian/source/format"), "3.0 (native)\n");
    writeFileSync(path.join(source, "debian/control"), "Source: mcp-inspector\nSection: devel\nPriority: optional\nMaintainer: PPA CI test <ci@example.invalid>\n\nPackage: mcp-inspector\nArchitecture: all\nDescription: PPA signing test fixture\n");
    writeFileSync(path.join(source, "debian/changelog"), "mcp-inspector (0.0.0) jammy; urgency=medium\n\n  * Signing test fixture.\n\n -- PPA CI test <ci@example.invalid>  Tue, 27 Oct 2026 12:00:00 +0000\n");
    writeFileSync(path.join(source, "debian/rules"), "#!/usr/bin/make -f\nclean:\n\ttrue\n", { mode: 0o755 });
    execFileSync("dpkg-buildpackage", ["-S", "-us", "-uc", "-d"], { cwd: source, env, stdio: ["pipe", "pipe", "pipe"] });
    writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify({ ppa: "ppa:ropi11/mcp-inspector", uploads: [{ series: "jammy", version: "0.0.0", changes: "mcp-inspector_0.0.0_source.changes" }] })}\n`);
    const args = ["scripts/upload-ppa.mjs", "--output", output, "--key", fingerprint, "--batch", "--passphrase-file", env.PPA_GPG_PASSPHRASE_FILE, "--sign-only"];
    for (let attempt = 0; attempt < 2; attempt++) {
      execFileSync(process.execPath, args, { cwd: repository, env, stdio: ["pipe", "pipe", "pipe"] });
      for (const suffix of [".dsc", "_source.buildinfo", "_source.changes"]) {
        execFileSync("gpg", ["--batch", "--verify", path.join(output, `mcp-inspector_0.0.0${suffix}`)], { env, stdio: ["pipe", "pipe", "pipe"] });
      }
    }
    assert.ok(existsSync(home));
  } finally {
    execFileSync(process.execPath, ["scripts/ppa-gpg.mjs", "cleanup"], { cwd: repository, env });
  }
  assert.equal(existsSync(env.PPA_GPG_CREDENTIALS_DIRECTORY), false);
  assert.ok(existsSync(home));
});

test("CI rejects an incorrect passphrase and removes the imported credentials", { timeout: 120000 }, () => {
  const directory = path.join(root, "failure");
  const env = environment(directory, "incorrect-passphrase");
  const result = spawnSync(process.execPath, ["scripts/ppa-gpg.mjs", "setup"], { cwd: repository, env, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(env.GITHUB_ENV, "utf8"), "");
  assert.equal(readdirSync(directory).some((name) => name.startsWith("mcp-inspector-ppa-gpg-")), false);
  assert.ok(existsSync(home));
});
