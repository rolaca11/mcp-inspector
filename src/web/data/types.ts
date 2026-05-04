/**
 * UI types modeled on the MCP SDK shapes used in src/actions.ts and on what
 * `/api/servers/:name/discover` actually returns. Kept in their own file so
 * pages and the API client import the same definitions.
 */

export type Transport = "stdio" | "http" | "sse" | "streamable-http";

export interface MCPServer {
  /** Slug used in `.mcp.json#/mcpServers/<name>`. */
  name: string;
  title?: string;
  /** Where this entry was loaded from on disk. */
  source: string;
  transport: Transport;
  /** stdio command (joined argv) or HTTP URL. */
  target: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  headers?: Record<string, string>;
}

export interface ServerInfo {
  name: string;
  title?: string;
  version?: string;
  instructions?: string;
}

/** What an MCP server advertises in its initialize handshake. */
export interface ServerCapabilities {
  resources?: { listChanged?: boolean; subscribe?: boolean };
  tools?: { listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  completions?: Record<string, unknown>;
  logging?: Record<string, unknown>;
  /** Anything else the server reports — surfaced verbatim. */
  [key: string]: unknown;
}

export interface AuthStatus {
  file: string;
  exists: boolean;
  hasTokens?: boolean;
  hasRefreshToken?: boolean;
  hasClientInfo?: boolean;
  tokenType?: string;
  scope?: string;
}

export interface MCPResource {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
}

export interface MCPResourceTemplate {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface MCPToolSchema {
  type: "object";
  properties?: Record<string, MCPToolSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean | object;
  // Allow extra JSON-schema fields ($schema, etc.) without complaining.
  [k: string]: unknown;
}

export interface MCPToolSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: Array<string | number>;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  items?: unknown;
  properties?: Record<string, MCPToolSchemaProperty>;
  required?: string[];
  [k: string]: unknown;
}

export interface MCPTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: MCPToolSchema;
  outputSchema?: unknown;
}

export interface MCPPromptArg {
  name: string;
  description?: string;
  required?: boolean;
}

export interface MCPPrompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: MCPPromptArg[];
}

/* ------------------------------------------------------------------ */
/* Result shapes returned by the action endpoints                      */
/* ------------------------------------------------------------------ */

export type ContentBlock =
  | { type: "text"; text: string; mimeType?: string; annotations?: unknown }
  | { type: "image"; data: string; mimeType: string; annotations?: unknown }
  | { type: "audio"; data: string; mimeType: string; annotations?: unknown }
  | {
      type: "resource";
      resource: {
        uri: string;
        mimeType?: string;
        text?: string;
        blob?: string;
      };
      annotations?: unknown;
    }
  | { type: "resource_link"; uri: string; mimeType?: string; description?: string };

export interface ToolResult {
  isError?: boolean;
  content: ContentBlock[];
  structuredContent?: unknown;
  /** Token count from the Anthropic Token Counting API (when available). */
  _tokenCount?: number | null;
}

export interface ResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface ReadResourceResult {
  contents: ResourceContents[];
  /** Token count from the Anthropic Token Counting API (when available). */
  _tokenCount?: number | null;
}

export interface PromptMessage {
  role: "user" | "assistant" | "system";
  content: ContentBlock;
}

export interface GetPromptResult {
  description?: string;
  messages: PromptMessage[];
  /** Token count from the Anthropic Token Counting API (when available). */
  _tokenCount?: number | null;
}

export interface CompleteResult {
  completion: {
    values: string[];
    total?: number;
    hasMore?: boolean;
  };
  /** Token count from the Anthropic Token Counting API (when available). */
  _tokenCount?: number | null;
}

export interface DiscoverResult {
  server: ServerInfo | null;
  capabilities: ServerCapabilities;
  resources: MCPResource[];
  resourceTemplates: MCPResourceTemplate[];
  tools: MCPTool[];
  prompts: MCPPrompt[];
  /** Token count from the Anthropic Token Counting API (when available). */
  _tokenCount?: number | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Pulls the variable names out of an RFC 6570-flavoured URI template.
 * Good enough for the inspector — we don't try to interpret operators
 * (`+`, `#`, `?`, `&`, ...), we just collect the bare names.
 */
export function extractTemplateVariables(uriTemplate: string): string[] {
  const out: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(uriTemplate)) !== null) {
    const inner = m[1] ?? "";
    // Strip a leading operator if present.
    const body = /^[+#./;?&]/.test(inner) ? inner.slice(1) : inner;
    for (const piece of body.split(",")) {
      // Strip explode `*` and length `:N` modifiers.
      const name = piece.replace(/[*:].*$/, "").trim();
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/**
 * Substitute variable values into a URI template. Unknown vars are left as-is
 * so the user can see what's missing.
 */
export function expandTemplate(
  uriTemplate: string,
  vars: Record<string, string>,
): string {
  return uriTemplate.replace(/\{([^}]+)\}/g, (full, body: string) => {
    const op = /^[+#./;?&]/.test(body) ? body[0]! : "";
    const inner = op ? body.slice(1) : body;
    const names = inner.split(",").map((n) => n.replace(/[*:].*$/, "").trim());
    const missing: string[] = [];
    const resolved = names
      .map((n) => {
        const v = vars[n];
        if (v == null || v === "") {
          missing.push(n);
          return undefined;
        }
        return op === "+" || op === "#" ? v : encodeURIComponent(v);
      })
      .filter((v): v is string => v !== undefined);
    if (resolved.length === 0) return full; // leave as-is when nothing supplied
    if (missing.length > 0 && resolved.length === 0) return full;
    if (op === "?")
      return `?${names
        .filter((n) => vars[n] != null && vars[n] !== "")
        .map((n) => `${n}=${encodeURIComponent(vars[n] ?? "")}`)
        .join("&")}`;
    if (op === "&")
      return `&${names
        .filter((n) => vars[n] != null && vars[n] !== "")
        .map((n) => `${n}=${encodeURIComponent(vars[n] ?? "")}`)
        .join("&")}`;
    if (op === "/" || op === "." || op === ";" || op === "#" || op === "+") {
      const sep = op === "+" || op === "#" ? "," : op === "." ? "." : "/";
      return (op === "#" ? "#" : op === "+" ? "" : sep) + resolved.join(sep);
    }
    return resolved.join(",");
  });
}
