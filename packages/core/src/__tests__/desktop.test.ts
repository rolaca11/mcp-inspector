import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { desktopLaunchUrl, readDesktopLaunchOptions } from "../desktop.js";
import { loadConfigSync } from "../config.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-desktop-"));
  vi.stubEnv("XDG_CONFIG_HOME", path.join(tmp, "config"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("desktop launch configuration", () => {
  it("leaves ordinary desktop startup unchanged", () => {
    expect(readDesktopLaunchOptions(["electron", "main.js", "--no-sandbox"])).toBeUndefined();
  });

  it("loads project and extra files in the same order as serve, including reloads", () => {
    const project = path.join(tmp, ".mcp.json");
    const extra = path.join(tmp, "team config.json");
    fs.writeFileSync(project, JSON.stringify({ mcpServers: { project: { command: "node" } } }));
    fs.writeFileSync(extra, JSON.stringify({ mcpServers: { team: { url: "https://example.com/mcp" } } }));
    const options = readDesktopLaunchOptions(["electron", desktopLaunchUrl({ cwd: tmp, extraFiles: [extra], quiet: true })])!;
    const configOpts = { cwd: options.cwd, extraFiles: options.extraFiles, home: path.join(tmp, "home") };
    const initial = loadConfigSync(configOpts);
    expect([...initial.servers.keys()]).toEqual(["project", "team"]);
    expect(initial.sources.map((source) => source.path)).toEqual([project, extra]);
    fs.writeFileSync(extra, JSON.stringify({ mcpServers: { updated: { command: "echo" } } }));
    expect([...loadConfigSync(configOpts).servers.keys()]).toEqual(["project", "updated"]);
  });

  it("rejects malformed launch configuration", () => {
    expect(() => readDesktopLaunchOptions(['mcp-inspector://launch?config=%7B%22cwd%22%3A42%7D'])).toThrow();
    expect(() => desktopLaunchUrl({ cwd: "relative", extraFiles: [], quiet: false })).toThrow();
  });

  it("preserves URL-sensitive characters in directory and config paths", () => {
    const options = {
      cwd: path.join(tmp, "project #1 + árvíz"),
      extraFiles: [path.join(tmp, "team?x=1&local%.json")],
      quiet: false,
    };
    expect(readDesktopLaunchOptions([desktopLaunchUrl(options)])).toEqual(options);
  });

  it("rejects unsupported URLs and missing payloads", () => {
    expect(() => readDesktopLaunchOptions(["mcp-inspector://other"])).toThrow("Invalid desktop launch URL");
    expect(() => readDesktopLaunchOptions(["mcp-inspector://launch"])).toThrow("Missing desktop launch configuration");
    expect(readDesktopLaunchOptions(["https://example.com/launch"])).toBeUndefined();
  });
});
