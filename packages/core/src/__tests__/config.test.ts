import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfigSync } from "../config.js";

let tmpDir: string;
let originalXDG: string | undefined;

beforeEach(() => {
  originalXDG = process.env.XDG_CONFIG_HOME;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-config-test-"));
  // Point configDir() at the temp dir so the inspector config doesn't leak
  process.env.XDG_CONFIG_HOME = tmpDir;
});

afterEach(() => {
  if (originalXDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXDG;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data));
}

describe("loadConfigSync", () => {
  it("returns empty when no config files exist", () => {
    const result = loadConfigSync({ cwd: tmpDir, home: tmpDir });
    expect(result.servers.size).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("loads stdio server from cwd .mcp.json", () => {
    writeJson(path.join(tmpDir, ".mcp.json"), {
      mcpServers: {
        myserver: { command: "node", args: ["server.js"] },
      },
    });
    const result = loadConfigSync({
      cwd: tmpDir,
      home: path.join(tmpDir, "fakehome"),
    });
    expect(result.servers.size).toBe(1);
    const entry = result.servers.get("myserver");
    expect(entry?.config).toEqual({
      command: "node",
      args: ["server.js"],
      cwd: tmpDir,
    });
    expect(entry?.label).toBe("project");
  });

  it("loads HTTP server from home .mcp.json", () => {
    const homeDir = path.join(tmpDir, "home");
    writeJson(path.join(homeDir, ".mcp.json"), {
      mcpServers: {
        remote: { url: "https://example.com/mcp", type: "sse" },
      },
    });
    const result = loadConfigSync({
      cwd: path.join(tmpDir, "empty"),
      home: homeDir,
    });
    expect(result.servers.size).toBe(1);
    const entry = result.servers.get("remote");
    expect(entry?.config).toEqual({
      url: "https://example.com/mcp",
      type: "sse",
    });
    expect(entry?.label).toBe("global");
  });

  it("keeps duplicate names from different config files", () => {
    const homeDir = path.join(tmpDir, "home");
    writeJson(path.join(homeDir, ".mcp.json"), {
      mcpServers: { srv: { url: "https://home.example.com" } },
    });
    writeJson(path.join(tmpDir, ".mcp.json"), {
      mcpServers: { srv: { url: "https://project.example.com" } },
    });
    const result = loadConfigSync({ cwd: tmpDir, home: homeDir });
    expect(result.servers.size).toBe(2);

    const entries = Array.from(result.servers.values()).filter(
      (entry) => entry.name === "srv",
    );
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => (entry.config as { url: string }).url)).toEqual([
      "https://home.example.com",
      "https://project.example.com",
    ]);
    expect(entries.map((entry) => entry.label)).toEqual(["global", "project"]);
    expect(entries.every((entry) => entry.id.startsWith("srv#"))).toBe(true);
  });

  it("records error for invalid JSON", () => {
    fs.writeFileSync(path.join(tmpDir, ".mcp.json"), "not json {{{");
    const result = loadConfigSync({
      cwd: tmpDir,
      home: path.join(tmpDir, "home"),
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/invalid JSON/);
  });

  it("records error for non-object top level", () => {
    fs.writeFileSync(path.join(tmpDir, ".mcp.json"), "[]");
    const result = loadConfigSync({
      cwd: tmpDir,
      home: path.join(tmpDir, "home"),
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/expected an object/);
  });

  it("records error for non-object mcpServers", () => {
    writeJson(path.join(tmpDir, ".mcp.json"), { mcpServers: "invalid" });
    const result = loadConfigSync({
      cwd: tmpDir,
      home: path.join(tmpDir, "home"),
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(
      /`mcpServers` must be an object/,
    );
  });

  it("reports source even when mcpServers key is absent", () => {
    writeJson(path.join(tmpDir, ".mcp.json"), { other: true });
    const result = loadConfigSync({
      cwd: tmpDir,
      home: path.join(tmpDir, "home"),
    });
    expect(result.sources).toHaveLength(1);
    expect(result.servers.size).toBe(0);
  });

  it("skips malformed entries and reports errors", () => {
    writeJson(path.join(tmpDir, ".mcp.json"), {
      mcpServers: {
        good: { command: "echo" },
        bad: { noCommandOrUrl: true },
      },
    });
    const result = loadConfigSync({
      cwd: tmpDir,
      home: path.join(tmpDir, "home"),
    });
    expect(result.servers.size).toBe(1);
    expect(result.servers.has("good")).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/mcpServers\.bad/);
  });

  it("loads extraFiles alongside project entries with the same name", () => {
    const extraFile = path.join(tmpDir, "extra.json");
    writeJson(extraFile, {
      mcpServers: { srv: { command: "extra-cmd" } },
    });
    writeJson(path.join(tmpDir, ".mcp.json"), {
      mcpServers: { srv: { command: "project-cmd" } },
    });
    const result = loadConfigSync({
      cwd: tmpDir,
      home: path.join(tmpDir, "home"),
      extraFiles: [extraFile],
    });
    const entries = Array.from(result.servers.values()).filter(
      (entry) => entry.name === "srv",
    );
    expect(entries.map((entry) => (entry.config as { command: string }).command)).toEqual([
      "project-cmd",
      "extra-cmd",
    ]);
    expect(entries.map((entry) => entry.label)).toEqual(["project", "--config"]);
  });

  it("parses full stdio config with env, cwd, type", () => {
    writeJson(path.join(tmpDir, ".mcp.json"), {
      mcpServers: {
        full: {
          command: "node",
          args: ["index.js"],
          env: { PORT: "3000" },
          cwd: "/opt/app",
          type: "stdio",
        },
      },
    });
    const result = loadConfigSync({
      cwd: tmpDir,
      home: path.join(tmpDir, "home"),
    });
    const cfg = result.servers.get("full")?.config as {
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd: string;
      type: string;
    };
    expect(cfg.command).toBe("node");
    expect(cfg.args).toEqual(["index.js"]);
    expect(cfg.env).toEqual({ PORT: "3000" });
    expect(cfg.cwd).toBe("/opt/app");
    expect(cfg.type).toBe("stdio");
  });

  it("parses HTTP config with headers and type", () => {
    writeJson(path.join(tmpDir, ".mcp.json"), {
      mcpServers: {
        api: {
          url: "https://api.example.com",
          headers: { Authorization: "Bearer token" },
          type: "streamable-http",
        },
      },
    });
    const result = loadConfigSync({
      cwd: tmpDir,
      home: path.join(tmpDir, "home"),
    });
    const cfg = result.servers.get("api")?.config as {
      url: string;
      headers: Record<string, string>;
      type: string;
    };
    expect(cfg.url).toBe("https://api.example.com");
    expect(cfg.headers).toEqual({ Authorization: "Bearer token" });
    expect(cfg.type).toBe("streamable-http");
  });

  it("deduplicates when cwd === home", () => {
    writeJson(path.join(tmpDir, ".mcp.json"), {
      mcpServers: { test: { command: "echo" } },
    });
    const result = loadConfigSync({ cwd: tmpDir, home: tmpDir });
    const mcpSources = result.sources.filter((s) =>
      s.path.endsWith(".mcp.json"),
    );
    expect(mcpSources).toHaveLength(1);
  });

  it("merges servers from multiple files", () => {
    const homeDir = path.join(tmpDir, "home");
    writeJson(path.join(homeDir, ".mcp.json"), {
      mcpServers: { from_home: { command: "echo" } },
    });
    writeJson(path.join(tmpDir, ".mcp.json"), {
      mcpServers: { from_project: { url: "https://proj.example.com" } },
    });
    const result = loadConfigSync({ cwd: tmpDir, home: homeDir });
    expect(result.servers.size).toBe(2);
    expect(result.servers.has("from_home")).toBe(true);
    expect(result.servers.has("from_project")).toBe(true);
  });
});
