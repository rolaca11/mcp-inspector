import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { configDir, authFile } from "../paths.js";

describe("configDir", () => {
  const originalXDG = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    if (originalXDG === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXDG;
  });

  it("returns XDG-based path when XDG_CONFIG_HOME is set", () => {
    process.env.XDG_CONFIG_HOME = "/custom/config";
    expect(configDir()).toBe("/custom/config/mcp-inspector");
  });

  it("returns default ~/.config path when XDG_CONFIG_HOME is unset", () => {
    delete process.env.XDG_CONFIG_HOME;
    expect(configDir()).toBe(
      path.join(os.homedir(), ".config", "mcp-inspector"),
    );
  });

  it("ignores whitespace-only XDG_CONFIG_HOME", () => {
    process.env.XDG_CONFIG_HOME = "   ";
    expect(configDir()).toBe(
      path.join(os.homedir(), ".config", "mcp-inspector"),
    );
  });
});

describe("authFile", () => {
  it("returns path under configDir/auth/", () => {
    const result = authFile("test-id");
    expect(result).toBe(path.join(configDir(), "auth", "test-id.json"));
  });

  it("includes the target id in the filename", () => {
    expect(authFile("my_server")).toMatch(/my_server\.json$/);
  });
});
