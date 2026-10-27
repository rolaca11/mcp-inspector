import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { createServer } from "node:https";
import { promisify } from "node:util";

if (process.versions.electron) process.noAsar = true;

const artifact = process.argv[2];
assert.ok(artifact, "Usage: bun scripts/verify-deb.mjs <package.deb>");

const root = await mkdtemp(path.join(tmpdir(), "mcp-inspector-deb-"));
let server;
let tlsServer;
try {
  execFileSync("dpkg-deb", ["--extract", artifact, root]);
  const contents = execFileSync("dpkg-deb", ["--contents", artifact], { encoding: "utf8" });
  assert.doesNotMatch(contents, /\s\.\/opt(?:\/|$)/m);
  const app = path.join(root, "usr/lib/mcp-inspector");
  const executable = path.join(app, "mcp-inspector-desktop");
  const cli = path.join(app, "resources/app.asar/dist/cli.js");
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    XDG_CONFIG_HOME: path.join(root, "config"),
  };
  const run = (...args) => execFileSync(executable, [cli, ...args], {
    env,
    encoding: "utf8",
    timeout: 15000,
  });

  const desktop = await readFile(path.join(root, "usr/share/applications/mcp-inspector-desktop.desktop"), "utf8");
  assert.match(desktop, /Exec=.*mcp-inspector-desktop.*%U/);
  assert.match(desktop, /Exec=.*\/usr\/lib\/mcp-inspector\/mcp-inspector-desktop/);
  assert.match(desktop, /MimeType=.*x-scheme-handler\/mcp-inspector/);
  assert.match(run("--version"), /^\d+\.\d+\.\d+/);
  assert.match(run("--help"), /desktop/);

  const launcher = path.join(root, "usr/bin/mcp-inspector");
  const launcherText = await readFile(launcher, "utf8");
  assert.match(launcherText, /\/usr\/lib\/mcp-inspector/);
  await writeFile(launcher, launcherText.replaceAll("/usr/lib/mcp-inspector", app));
  assert.match(execFileSync(launcher, ["--version"], { encoding: "utf8", timeout: 15000 }), /^\d+\.\d+\.\d+/);

  const opener = path.join(root, "usr/bin/xdg-open");
  const launchRequest = path.join(root, "launch-request.json");
  await writeFile(opener, '#!/bin/sh\nprintf \'%s\\n%s\\n\' "$ELECTRON_RUN_AS_NODE" "$1" > "$MCPI_LAUNCH_REQUEST"\n', { mode: 0o755 });
  execFileSync(launcher, ["desktop", "--quiet"], {
    cwd: root,
    env: { ...env, PATH: `${path.dirname(opener)}:${process.env.PATH}`, MCPI_LAUNCH_REQUEST: launchRequest },
    timeout: 15000,
  });
  const [runtimeFlag, launchUrl] = (await readFile(launchRequest, "utf8")).split("\n");
  assert.equal(runtimeFlag, "");
  assert.equal(JSON.parse(new URL(launchUrl).searchParams.get("config")).cwd, root);

  const certificate = path.join(root, "localhost.crt");
  const key = path.join(root, "localhost.key");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1",
    "-keyout", key, "-out", certificate,
  ], { stdio: "ignore" });
  tlsServer = createServer({ key: await readFile(key), cert: await readFile(certificate) }, async (request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const { id, method } = JSON.parse(body);
    if (id === undefined) {
      response.writeHead(202).end();
      return;
    }
    const results = {
      initialize: {
        protocolVersion: "2025-11-25",
        serverInfo: { name: "tls-test", version: "1.0.0" },
        capabilities: { tools: {} },
      },
      "tools/list": { tools: [{ name: "tls-check", inputSchema: { type: "object" } }] },
    };
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      jsonrpc: "2.0", id,
      ...(method in results ? { result: results[method] } : { error: { code: -32601, message: "Method not found" } }),
    }));
  });
  tlsServer.listen(0, "127.0.0.1");
  await once(tlsServer, "listening");
  const tlsUrl = `https://127.0.0.1:${tlsServer.address().port}`;
  const tlsEnv = { ...env };
  delete tlsEnv.NODE_EXTRA_CA_CERTS;
  const execute = promisify(execFile);
  const tlsArgs = [cli, "tools", "list", tlsUrl, "--json", "--quiet"];
  const diagnostic = path.join(root, "tls-diagnostic.mjs");
  await writeFile(diagnostic, `
const fetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  try {
    return await fetch(...args);
  } catch (error) {
    console.error(error.cause?.code);
    throw error;
  }
};
`);
  await assert.rejects(execute(executable, ["--import", diagnostic, ...tlsArgs], { env: tlsEnv, timeout: 15000 }), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.killed, false);
    assert.match(error.stderr, /\bDEPTH_ZERO_SELF_SIGNED_CERT\b/);
    return true;
  });
  const result = await execute(executable, tlsArgs, {
    env: { ...tlsEnv, SSL_CERT_FILE: certificate, SSL_CERT_DIR: root },
    timeout: 15000,
  });
  assert.equal(JSON.parse(result.stdout)[0].name, "tls-check");

  let output = "";
  server = spawn(executable, [cli, "serve", "--port", "0", "--no-open"], { env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  server.on("error", (error) => { output += error.message; });
  let url;
  for (let attempt = 0; attempt < 100; attempt++) {
    url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (url || server.exitCode !== null) break;
    await setTimeout(100);
  }
  assert.ok(url, `Packaged server did not start: ${output}`);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const html = await response.text();
  const asset = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(asset, "Dashboard HTML must include its JavaScript bundle");
  assert.equal((await fetch(new URL(asset, url))).status, 200);
  console.log("Debian package verified: CLI, desktop handler, desktop launch, system CA trust, and dashboard.");
} finally {
  if (tlsServer) {
    tlsServer.closeAllConnections();
    await new Promise((resolve) => tlsServer.close(resolve));
  }
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill("SIGTERM");
    await stopped;
  }
  await rm(root, { recursive: true, force: true });
}
