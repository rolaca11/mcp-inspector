import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { desktopLaunchArg, readDesktopLaunchOptions } from "../desktop.js";
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
    const options = readDesktopLaunchOptions(["electron", desktopLaunchArg({ cwd: tmp, extraFiles: [extra], quiet: true })])!;
    const configOpts = { cwd: options.cwd, extraFiles: options.extraFiles, home: path.join(tmp, "home") };
    const initial = loadConfigSync(configOpts);
    expect([...initial.servers.keys()]).toEqual(["project", "team"]);
    expect(initial.sources.map((source) => source.path)).toEqual([project, extra]);
    fs.writeFileSync(extra, JSON.stringify({ mcpServers: { updated: { command: "echo" } } }));
    expect([...loadConfigSync(configOpts).servers.keys()]).toEqual(["project", "updated"]);
  });

  it("rejects malformed launch configuration", () => {
    expect(() => readDesktopLaunchOptions(['--mcp-inspector-launch={"cwd":42}'])).toThrow();
    expect(() => desktopLaunchArg({ cwd: "relative", extraFiles: [], quiet: false })).toThrow();
  });
});
