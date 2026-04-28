/**
 * Parses a CLI "target" — the user-supplied string that points at an MCP server.
 *
 * Resolution order:
 *   1. Named server defined in a loaded `.mcp.json` (see config.ts), if any.
 *   2. HTTP(S) URL                              → Streamable HTTP transport.
 *   3. Anything else                            → shell-split as a stdio command.
 *
 * For stdio commands the user typically quotes the whole thing:
 *   mcp-inspector tools list "npx -y @modelcontextprotocol/server-everything stdio"
 *
 * For named servers users just type the name:
 *   mcp-inspector tools list everything
 */

import { parse as shellParse } from "shell-quote";

import type { LoadedConfig, ServerConfig } from "./config.js";

export type TargetSpec =
  | {
      kind: "http";
      url: URL;
      /** Extra HTTP headers (from named-config `headers`). */
      headers?: Record<string, string>;
      /** Original string the user typed (or the resolved name). */
      raw: string;
      /** When resolved from .mcp.json, the alias used to look it up. */
      name?: string;
    }
  | {
      kind: "stdio";
      command: string;
      args: string[];
      /** Extra env vars merged on top of `process.env` (from named-config `env`). */
      env?: Record<string, string>;
      /** Working directory for the child process (from named-config `cwd`). */
      cwd?: string;
      raw: string;
      name?: string;
    };

let cachedConfig: LoadedConfig | undefined;

/** Provide the loaded `.mcp.json` data so `parseTarget` can resolve names. */
export function setLoadedConfig(c: LoadedConfig | undefined): void {
  cachedConfig = c;
}

/** Returns the most recently `setLoadedConfig`-passed value. */
export function getLoadedConfig(): LoadedConfig | undefined {
  return cachedConfig;
}

export function parseTarget(input: string, extraStdioArgs: string[] = []): TargetSpec {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error(
      "Empty target. Pass a URL, a stdio command, or a named server.",
    );
  }

  // 1. Named-server lookup — wins over URL/stdio interpretation, so users can
  // shadow ambiguous strings deliberately.
  if (cachedConfig) {
    const named = cachedConfig.servers.get(trimmed);
    if (named) {
      return resolveNamed(trimmed, named.config);
    }
  }

  // 2. URL.
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error(`Invalid URL: ${trimmed}`);
    }
    return { kind: "http", url, raw: trimmed };
  }

  // 3. Stdio command.
  const tokens = shellParse(trimmed)
    .filter((t): t is string => typeof t === "string");
  if (tokens.length === 0) {
    throw new Error(`Could not parse stdio command: ${input}`);
  }
  const [command, ...args] = tokens as [string, ...string[]];
  return {
    kind: "stdio",
    command,
    args: [...args, ...extraStdioArgs],
    raw: trimmed,
  };
}

function resolveNamed(name: string, cfg: ServerConfig): TargetSpec {
  if ("url" in cfg) {
    let url: URL;
    try {
      url = new URL(cfg.url);
    } catch {
      throw new Error(`Named server "${name}" has invalid URL: ${cfg.url}`);
    }
    const out: TargetSpec = { kind: "http", url, raw: name, name };
    if (cfg.headers && Object.keys(cfg.headers).length > 0) {
      out.headers = cfg.headers;
    }
    return out;
  }

  const out: TargetSpec = {
    kind: "stdio",
    command: cfg.command,
    args: cfg.args ?? [],
    raw: name,
    name,
  };
  if (cfg.env && Object.keys(cfg.env).length > 0) out.env = cfg.env;
  if (cfg.cwd) out.cwd = cfg.cwd;
  return out;
}

/**
 * Stable, filesystem-safe identifier for a target — used as the OAuth token
 * filename and as a human-facing label in some output. Derived from the
 * underlying transport (URL or command+args), NOT the alias name, so that two
 * different aliases pointing at the same server share OAuth state.
 */
export function targetId(target: TargetSpec): string {
  if (target.kind === "http") {
    const { hostname, port, pathname } = target.url;
    const path = pathname.replace(/\/+/g, "_").replace(/^_+|_+$/g, "");
    const portPart = port ? `_${port}` : "";
    const pathPart = path ? `_${path}` : "";
    return sanitize(`http_${hostname}${portPart}${pathPart}`);
  }
  return sanitize(`stdio_${target.command}_${target.args.join("_")}`);
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}
