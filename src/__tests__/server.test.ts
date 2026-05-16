import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpDir: string;
let originalXDG: string | undefined;
let serverUrl: string;
let closeServer: () => Promise<void>;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-server-test-"));
  originalXDG = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmpDir;

  // Create a static dir with a test file for static serving tests
  const staticDir = path.join(tmpDir, "static");
  fs.mkdirSync(staticDir, { recursive: true });
  fs.writeFileSync(
    path.join(staticDir, "index.html"),
    "<html><body>test</body></html>",
  );
  fs.writeFileSync(
    path.join(staticDir, "app.js"),
    "console.log('test');",
  );

  const { startServer } = await import("../server.js");
  const server = await startServer({
    port: 0,
    host: "127.0.0.1",
    quiet: true,
    staticDir,
  });
  serverUrl = server.url;
  closeServer = server.close;
});

afterAll(async () => {
  if (closeServer) await closeServer();
  if (originalXDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXDG;
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("HTTP server", () => {
  /* ---------------------------------------------------------------- */
  /* CORS & OPTIONS                                                    */
  /* ---------------------------------------------------------------- */

  it("returns CORS headers on API responses", async () => {
    const res = await fetch(`${serverUrl}/api/trpc/health.check`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("handles OPTIONS preflight requests", async () => {
    const res = await fetch(`${serverUrl}/api/trpc/health.check`, {
      method: "OPTIONS",
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain(
      "content-type",
    );
  });

  /* ---------------------------------------------------------------- */
  /* tRPC health endpoint                                              */
  /* ---------------------------------------------------------------- */

  it("health.check returns ok via HTTP", async () => {
    const res = await fetch(`${serverUrl}/api/trpc/health.check`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.data).toEqual({ ok: true });
  });

  it("does not serve the SPA for old /api routes", async () => {
    const res = await fetch(`${serverUrl}/api/health`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.message).toContain("/api/trpc");
  });

  it("does not serve the SPA for the /api root", async () => {
    const res = await fetch(`${serverUrl}/api`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.message).toContain("/api/trpc");
  });

  /* ---------------------------------------------------------------- */
  /* tRPC servers.list endpoint                                        */
  /* ---------------------------------------------------------------- */

  it("servers.list returns server summary via HTTP", async () => {
    const res = await fetch(`${serverUrl}/api/trpc/servers.list`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.data).toHaveProperty("servers");
    expect(body.result.data).toHaveProperty("sources");
  });

  /* ---------------------------------------------------------------- */
  /* tRPC config endpoints                                             */
  /* ---------------------------------------------------------------- */

  it("config.list returns empty initially via HTTP", async () => {
    const res = await fetch(`${serverUrl}/api/trpc/config.list`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.data.servers).toEqual({});
  });

  it("config.add and config.remove via HTTP", async () => {
    // Add
    const addRes = await fetch(`${serverUrl}/api/trpc/config.add`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "http-test-server",
        config: { command: "echo", args: ["test"] },
      }),
    });
    expect(addRes.status).toBe(200);
    const addBody = await addRes.json();
    expect(addBody.result.data.ok).toBe(true);

    // Verify it exists
    const listRes = await fetch(`${serverUrl}/api/trpc/config.list`);
    const listBody = await listRes.json();
    expect(listBody.result.data.servers).toHaveProperty("http-test-server");

    // Remove
    const removeRes = await fetch(`${serverUrl}/api/trpc/config.remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "http-test-server" }),
    });
    expect(removeRes.status).toBe(200);

    // Verify it's gone
    const listRes2 = await fetch(`${serverUrl}/api/trpc/config.list`);
    const listBody2 = await listRes2.json();
    expect(listBody2.result.data.servers).not.toHaveProperty(
      "http-test-server",
    );
  });

  /* ---------------------------------------------------------------- */
  /* Static file serving                                               */
  /* ---------------------------------------------------------------- */

  it("serves index.html at root", async () => {
    const res = await fetch(`${serverUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const text = await res.text();
    expect(text).toContain("<html>");
  });

  it("serves static JS files with correct MIME type", async () => {
    const res = await fetch(`${serverUrl}/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  it("falls back to index.html for SPA routes", async () => {
    const res = await fetch(`${serverUrl}/some/spa/route`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<html>");
  });

  /* ---------------------------------------------------------------- */
  /* Error handling                                                    */
  /* ---------------------------------------------------------------- */

  it("prevents path traversal", async () => {
    const res = await fetch(`${serverUrl}/../../../etc/passwd`);
    // Should not serve files outside static dir
    expect([200, 403, 404]).toContain(res.status);
    const text = await res.text();
    expect(text).not.toContain("root:");
  });
});
