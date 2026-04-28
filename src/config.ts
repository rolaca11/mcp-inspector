/**
 * Reads `.mcp.json` configuration files so users can address MCP servers by
 * short names (e.g. `mcp-inspector connect everything`) rather than always
 * supplying a URL or a shell command.
 *
 * Two locations are read, in this precedence order (last wins on conflicts):
 *   1. `~/.mcp.json`            — user-global config
 *   2. `<cwd>/.mcp.json`        — project-local config
 *
 * The file format follows the de-facto convention used by Claude Desktop,
 * Claude Code and other MCP clients:
 *
 *   {
 *     "mcpServers": {
 *       "everything": {
 *         "command": "npx",
 *         "args": ["-y", "@modelcontextprotocol/server-everything", "stdio"],
 *         "env": { "DEBUG": "1" }
 *       },
 *       "remote": {
 *         "type": "http",
 *         "url": "https://example.com/mcp",
 *         "headers": { "X-Foo": "bar" }
 *       }
 *     }
 *   }
 *
 * A server entry must declare either a `command` (stdio) or a `url` (HTTP).
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type StdioServerConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type HttpServerConfig = {
  type?: "http" | "sse" | "streamable-http";
  url: string;
  headers?: Record<string, string>;
};

export type ServerConfig = StdioServerConfig | HttpServerConfig;

export interface ConfigSource {
  /** Absolute path to the file that was read. */
  path: string;
  /** Servers declared in just this file (after validation). */
  servers: Record<string, ServerConfig>;
}

export interface ConfigError {
  path: string;
  message: string;
}

export interface LoadedConfig {
  /** Resolved name → config + provenance. CWD overrides home on conflicts. */
  servers: Map<string, { config: ServerConfig; source: string }>;
  /** Files actually read in load order (lowest precedence first). */
  sources: ConfigSource[];
  /** Files that existed but failed to parse / validate. */
  errors: ConfigError[];
}

export interface LoadConfigOptions {
  /** Override `process.cwd()` (testing). */
  cwd?: string;
  /** Override `os.homedir()` (testing). */
  home?: string;
}

export function loadConfigSync(opts: LoadConfigOptions = {}): LoadedConfig {
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? os.homedir();

  // Order matters: home first, then cwd, so cwd wins on duplicates.
  const candidates = [
    path.join(home, ".mcp.json"),
    path.join(cwd, ".mcp.json"),
  ];

  const servers = new Map<string, { config: ServerConfig; source: string }>();
  const sources: ConfigSource[] = [];
  const errors: ConfigError[] = [];

  // Avoid double-reading the same file when cwd === home.
  const seen = new Set<string>();
  for (const file of candidates) {
    const resolved = path.resolve(file);
    if (seen.has(resolved)) continue;
    seen.add(resolved);

    let raw: string;
    try {
      raw = readFileSync(resolved, "utf8");
    } catch (e) {
      if (!isENOENT(e)) {
        errors.push({ path: resolved, message: (e as Error).message });
      }
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      errors.push({
        path: resolved,
        message: `invalid JSON: ${(e as Error).message}`,
      });
      continue;
    }

    if (!isObject(parsed)) {
      errors.push({ path: resolved, message: "expected an object at top level" });
      continue;
    }
    const mcpServers = (parsed as { mcpServers?: unknown }).mcpServers;
    if (mcpServers === undefined) {
      // File exists but declares no servers — that's not an error.
      sources.push({ path: resolved, servers: {} });
      continue;
    }
    if (!isObject(mcpServers)) {
      errors.push({ path: resolved, message: "`mcpServers` must be an object" });
      continue;
    }

    const collected: Record<string, ServerConfig> = {};
    for (const [name, value] of Object.entries(mcpServers)) {
      const cfg = parseServerConfig(value);
      if (!cfg) {
        errors.push({
          path: resolved,
          message: `mcpServers.${name}: must be {command,args?,env?,cwd?} or {url,headers?,type?}`,
        });
        continue;
      }
      collected[name] = cfg;
      servers.set(name, { config: cfg, source: resolved });
    }
    sources.push({ path: resolved, servers: collected });
  }

  return { servers, sources, errors };
}

function parseServerConfig(value: unknown): ServerConfig | null {
  if (!isObject(value)) return null;
  const v = value;

  // Stdio (command-based) entry.
  if (typeof v.command === "string") {
    const cfg: StdioServerConfig = { command: v.command };
    if (Array.isArray(v.args) && v.args.every((a) => typeof a === "string")) {
      cfg.args = v.args as string[];
    } else if (v.args !== undefined && !Array.isArray(v.args)) {
      return null; // explicitly malformed
    }
    if (isStringMap(v.env)) cfg.env = v.env;
    if (typeof v.cwd === "string") cfg.cwd = v.cwd;
    if (v.type === "stdio") cfg.type = "stdio";
    return cfg;
  }

  // HTTP (url-based) entry.
  if (typeof v.url === "string") {
    const cfg: HttpServerConfig = { url: v.url };
    if (isStringMap(v.headers)) cfg.headers = v.headers;
    if (
      typeof v.type === "string" &&
      (v.type === "http" || v.type === "sse" || v.type === "streamable-http")
    ) {
      cfg.type = v.type;
    }
    return cfg;
  }

  return null;
}

function isObject(o: unknown): o is Record<string, unknown> {
  return typeof o === "object" && o !== null && !Array.isArray(o);
}

function isStringMap(o: unknown): o is Record<string, string> {
  if (!isObject(o)) return false;
  return Object.values(o).every((v) => typeof v === "string");
}

function isENOENT(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "ENOENT"
  );
}
