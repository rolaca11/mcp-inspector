import { describe, it, expect, beforeEach } from "vitest";
import {
  parseTarget,
  targetId,
  setLoadedConfig,
  getLoadedConfig,
  type TargetSpec,
} from "../target.js";
import type { LoadedConfig, ServerConfig } from "../config.js";

function makeConfig(
  servers: Record<string, ServerConfig>,
): LoadedConfig {
  const map = new Map<
    string,
    { config: ServerConfig; source: string; label: "project" }
  >();
  for (const [name, config] of Object.entries(servers)) {
    map.set(name, { config, source: "/test/.mcp.json", label: "project" });
  }
  return { servers: map, sources: [], errors: [] };
}

describe("parseTarget", () => {
  beforeEach(() => {
    setLoadedConfig(undefined);
  });

  it("throws on empty input", () => {
    expect(() => parseTarget("")).toThrow("Empty target");
    expect(() => parseTarget("   ")).toThrow("Empty target");
  });

  it("parses HTTP URL", () => {
    const result = parseTarget("http://example.com/mcp");
    expect(result).toEqual({
      kind: "http",
      url: new URL("http://example.com/mcp"),
      raw: "http://example.com/mcp",
    });
  });

  it("parses HTTPS URL", () => {
    const result = parseTarget("https://example.com/mcp");
    expect(result.kind).toBe("http");
    expect(
      (result as Extract<TargetSpec, { kind: "http" }>).url.protocol,
    ).toBe("https:");
  });

  it("parses stdio command with arguments", () => {
    const result = parseTarget("npx -y @mcp/server");
    expect(result).toEqual({
      kind: "stdio",
      command: "npx",
      args: ["-y", "@mcp/server"],
      raw: "npx -y @mcp/server",
    });
  });

  it("parses single-word stdio command", () => {
    const result = parseTarget("myserver");
    expect(result.kind).toBe("stdio");
    expect(
      (result as Extract<TargetSpec, { kind: "stdio" }>).command,
    ).toBe("myserver");
    expect(
      (result as Extract<TargetSpec, { kind: "stdio" }>).args,
    ).toEqual([]);
  });

  it("appends extraStdioArgs", () => {
    const result = parseTarget("node server.js", [
      "--port",
      "3000",
    ]) as Extract<TargetSpec, { kind: "stdio" }>;
    expect(result.args).toEqual(["server.js", "--port", "3000"]);
  });

  it("resolves named stdio server from config", () => {
    setLoadedConfig(
      makeConfig({
        everything: {
          command: "npx",
          args: ["-y", "@mcp/server-everything"],
        },
      }),
    );
    const result = parseTarget("everything") as Extract<
      TargetSpec,
      { kind: "stdio" }
    >;
    expect(result.kind).toBe("stdio");
    expect(result.name).toBe("everything");
    expect(result.command).toBe("npx");
    expect(result.args).toEqual(["-y", "@mcp/server-everything"]);
  });

  it("resolves named HTTP server from config with headers", () => {
    setLoadedConfig(
      makeConfig({
        remote: {
          url: "https://remote.example.com/mcp",
          headers: { "X-Key": "abc" },
        },
      }),
    );
    const result = parseTarget("remote") as Extract<
      TargetSpec,
      { kind: "http" }
    >;
    expect(result.kind).toBe("http");
    expect(result.name).toBe("remote");
    expect(result.headers).toEqual({ "X-Key": "abc" });
  });

  it("named server takes precedence over URL interpretation", () => {
    setLoadedConfig(
      makeConfig({
        "http://example.com": { command: "echo", args: ["test"] },
      }),
    );
    const result = parseTarget("http://example.com");
    expect(result.kind).toBe("stdio");
  });

  it("resolves named server with env and cwd", () => {
    setLoadedConfig(
      makeConfig({
        local: {
          command: "node",
          args: ["server.js"],
          env: { DEBUG: "1" },
          cwd: "/opt/server",
        },
      }),
    );
    const result = parseTarget("local") as Extract<
      TargetSpec,
      { kind: "stdio" }
    >;
    expect(result.env).toEqual({ DEBUG: "1" });
    expect(result.cwd).toBe("/opt/server");
  });

  it("omits empty headers on named HTTP server", () => {
    setLoadedConfig(
      makeConfig({
        bare: { url: "https://bare.example.com" },
      }),
    );
    const result = parseTarget("bare") as Extract<
      TargetSpec,
      { kind: "http" }
    >;
    expect(result.headers).toBeUndefined();
  });
});

describe("targetId", () => {
  it("generates id for HTTP target with port and path", () => {
    const spec: TargetSpec = {
      kind: "http",
      url: new URL("https://example.com:3000/api/mcp"),
      raw: "https://example.com:3000/api/mcp",
    };
    expect(targetId(spec)).toBe("http_example.com_3000_api_mcp");
  });

  it("generates id for HTTP target without port or path", () => {
    const spec: TargetSpec = {
      kind: "http",
      url: new URL("https://example.com/"),
      raw: "https://example.com/",
    };
    expect(targetId(spec)).toBe("http_example.com");
  });

  it("generates id for stdio target", () => {
    const spec: TargetSpec = {
      kind: "stdio",
      command: "npx",
      args: ["-y", "@mcp/server"],
      raw: "npx -y @mcp/server",
    };
    expect(targetId(spec)).toMatch(/^stdio_npx_-y_/);
  });

  it("sanitizes special characters to underscores", () => {
    const spec: TargetSpec = {
      kind: "stdio",
      command: "/usr/bin/node",
      args: ["script with spaces.js"],
      raw: '/usr/bin/node "script with spaces.js"',
    };
    const id = targetId(spec);
    expect(id).toMatch(/^[a-zA-Z0-9._-]+$/);
  });

  it("truncates to 120 characters", () => {
    const spec: TargetSpec = {
      kind: "stdio",
      command: "a".repeat(200),
      args: [],
      raw: "a".repeat(200),
    };
    expect(targetId(spec).length).toBeLessThanOrEqual(120);
  });
});

describe("setLoadedConfig / getLoadedConfig", () => {
  beforeEach(() => {
    setLoadedConfig(undefined);
  });

  it("stores and retrieves config", () => {
    const config = makeConfig({ test: { command: "echo" } });
    setLoadedConfig(config);
    expect(getLoadedConfig()).toBe(config);
  });

  it("can be cleared with undefined", () => {
    setLoadedConfig(makeConfig({}));
    setLoadedConfig(undefined);
    expect(getLoadedConfig()).toBeUndefined();
  });
});
