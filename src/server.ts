/**
 * `mcp-inspector serve` — boots the dashboard.
 *
 * The same process that holds long-lived MCP sessions also serves the static
 * UI bundle (`dist/web/`) and a small JSON API over the verbs in
 * `actions.ts`. The CLI and the web view talk to one client implementation;
 * there is no second process.
 *
 * API surface (intentionally narrow — every route maps to a single action):
 *
 *   GET    /api/health
 *   GET    /api/servers                          → loaded .mcp.json entries
 *   GET    /api/servers/:name/discover           → server info + capabilities + lists
 *   GET    /api/servers/:name/resources
 *   GET    /api/servers/:name/resources/templates
 *   POST   /api/servers/:name/resources/read     { uri }
 *   GET    /api/servers/:name/tools
 *   POST   /api/servers/:name/tools/call         { name, arguments? }
 *   GET    /api/servers/:name/prompts
 *   POST   /api/servers/:name/prompts/get        { name, arguments? }
 *   POST   /api/servers/:name/complete           { refType, ref, argument, value?, context? }
 *   GET    /api/servers/:name/auth               → on-disk OAuth status
 *   DELETE /api/servers/:name/auth               → logout
 *   POST   /api/servers/:name/disconnect
 *
 * Sessions are cached for `SESSION_IDLE_MS` after their last use. They are
 * always closed on process exit so child stdio processes are reaped.
 */

import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pc from "picocolors";

import { connect, type Session } from "./client.js";
import { loadConfigSync, type LoadedConfig } from "./config.js";
import { authFile } from "./paths.js";
import { setLoadedConfig, parseTarget, targetId } from "./target.js";

/* ------------------------------------------------------------------ */
/* Types and constants                                                 */
/* ------------------------------------------------------------------ */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** dist/web sits next to dist/cli.js after `vite build`. */
const DEFAULT_STATIC_DIR = path.resolve(__dirname, "./web");

/** Drop idle sessions after this many ms of inactivity. */
const SESSION_IDLE_MS = 5 * 60 * 1000;

/** Mime type lookup for the static handler. */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export interface ServeOptions {
  port?: number;
  host?: string;
  /** Suppress informational logs. */
  quiet?: boolean;
  /** Skip serving the bundled UI — only expose `/api`. */
  noUi?: boolean;
  /** Override the dist/web directory (e.g. for tests). */
  staticDir?: string;
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

export async function startServer(opts: ServeOptions = {}): Promise<{
  port: number;
  host: string;
  url: string;
  close(): Promise<void>;
}> {
  const port = opts.port ?? 8765;
  const host = opts.host ?? "127.0.0.1";

  // Load .mcp.json once at boot. Subsequent reloads happen on every request
  // so the UI sees edits without restarting the server (cheap — both files
  // are typically <1 KB).
  const initial = loadConfigSync();
  setLoadedConfig(initial);

  const sessions = new SessionPool();

  const staticDir = opts.staticDir ?? DEFAULT_STATIC_DIR;
  const staticAvailable = !opts.noUi && (await dirExists(staticDir));

  const server = http.createServer((req, res) =>
    handle(req, res, { sessions, staticDir, staticAvailable, opts }).catch(
      (err) => {
        console.error(pc.red("[serve] unhandled:"), err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: (err as Error).message }));
        } else {
          res.end();
        }
      },
    ),
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const boundPort = typeof addr === "object" && addr ? addr.port : port;
  const url = `http://${host}:${boundPort}`;

  if (!opts.quiet) {
    console.error(pc.bold(pc.green("mcp-inspector ready")));
    console.error(`  ${pc.dim("dashboard:")} ${pc.cyan(url)}`);
    console.error(`  ${pc.dim("api:")}       ${pc.cyan(`${url}/api`)}`);
    if (!staticAvailable && !opts.noUi) {
      console.error(
        pc.yellow(
          `  warning: ${staticDir} not found — UI not served. Run \`pnpm build:web\` or use \`--no-ui\`.`,
        ),
      );
    }
    if (initial.errors.length > 0) {
      for (const err of initial.errors) {
        console.error(pc.yellow(`  config warning: ${err.path}: ${err.message}`));
      }
    }
  }

  // Make sure stdio children get reaped on Ctrl-C.
  const teardown = async () => {
    await sessions.closeAll();
    await new Promise<void>((r) => server.close(() => r()));
  };
  process.once("SIGINT", () => void teardown().then(() => process.exit(0)));
  process.once("SIGTERM", () => void teardown().then(() => process.exit(0)));

  return {
    port: boundPort,
    host,
    url,
    close: teardown,
  };
}

/* ------------------------------------------------------------------ */
/* Request handler                                                     */
/* ------------------------------------------------------------------ */

interface HandlerCtx {
  sessions: SessionPool;
  staticDir: string;
  staticAvailable: boolean;
  opts: ServeOptions;
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: HandlerCtx,
): Promise<void> {
  const urlPath = (req.url ?? "/").split("?")[0] ?? "/";

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (urlPath.startsWith("/api/")) {
    return handleApi(req, res, urlPath, ctx);
  }

  if (!ctx.staticAvailable) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(
      "UI not built. Run `pnpm build:web` or pass `--no-ui` to serve only /api.",
    );
    return;
  }

  return serveStatic(req, res, urlPath, ctx.staticDir);
}

/* ------------------------------------------------------------------ */
/* API routes                                                          */
/* ------------------------------------------------------------------ */

async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  urlPath: string,
  ctx: HandlerCtx,
): Promise<void> {
  const method = req.method ?? "GET";
  const send = (status: number, body: unknown) =>
    sendJson(res, status, body);

  // /api/health
  if (urlPath === "/api/health" && method === "GET") {
    return send(200, { ok: true });
  }

  // /api/servers
  if (urlPath === "/api/servers" && method === "GET") {
    const config = loadConfigSync();
    setLoadedConfig(config);
    return send(200, summarizeServers(config));
  }

  // /api/servers/:name/...
  const match = urlPath.match(/^\/api\/servers\/([^/]+)(?:\/(.+))?$/);
  if (!match) return send(404, { error: "not found" });

  const name = decodeURIComponent(match[1]!);
  const sub = match[2] ?? "";

  // Reload config on every request so .mcp.json edits are picked up live.
  const config = loadConfigSync();
  setLoadedConfig(config);

  const entry = config.servers.get(name);
  if (!entry && !looksLikeRawTarget(name)) {
    return send(404, { error: `unknown server: ${name}` });
  }

  // ---- auth (does not require an active session) ----
  if (sub === "auth") {
    if (method === "GET") {
      const status = await readAuthStatus(name);
      return send(200, status);
    }
    if (method === "DELETE") {
      const removed = await deleteAuthFile(name);
      return send(200, removed);
    }
    return send(405, { error: "method not allowed" });
  }

  // ---- session-bound routes ----
  // Read body once for POST/PUT/PATCH.
  const body =
    method === "GET" || method === "DELETE"
      ? {}
      : await readJson(req).catch((e) => ({ __error: (e as Error).message }));
  if ((body as { __error?: string }).__error) {
    return send(400, { error: (body as { __error: string }).__error });
  }

  try {
    const session = await ctx.sessions.acquire(name);

    if ((sub === "discover" || sub === "") && method === "GET") {
      return send(200, await actionDiscover(session));
    }
    if (sub === "resources" && method === "GET") {
      const r = await session.client.listResources();
      return send(200, r);
    }
    if (sub === "resources/templates" && method === "GET") {
      const r = await session.client.listResourceTemplates();
      return send(200, r);
    }
    if (sub === "resources/read" && method === "POST") {
      const { uri } = body as { uri?: string };
      if (typeof uri !== "string") return send(400, { error: "missing `uri`" });
      const r = await session.client.readResource({ uri });
      return send(200, r);
    }
    if (sub === "tools" && method === "GET") {
      return send(200, await session.client.listTools());
    }
    if (sub === "tools/call" && method === "POST") {
      const { name: toolName, arguments: toolArgs } = body as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      if (typeof toolName !== "string")
        return send(400, { error: "missing `name`" });
      const r = await session.client.callTool({
        name: toolName,
        arguments: toolArgs ?? {},
      });
      return send(200, r);
    }
    if (sub === "prompts" && method === "GET") {
      return send(200, await session.client.listPrompts());
    }
    if (sub === "prompts/get" && method === "POST") {
      const { name: promptName, arguments: promptArgs } = body as {
        name?: string;
        arguments?: Record<string, string>;
      };
      if (typeof promptName !== "string")
        return send(400, { error: "missing `name`" });
      const r = await session.client.getPrompt({
        name: promptName,
        arguments: promptArgs ?? {},
      });
      return send(200, r);
    }
    if (sub === "complete" && method === "POST") {
      const {
        refType,
        ref,
        argument,
        value,
        context,
      } = body as {
        refType?: "prompt" | "resource";
        ref?: string;
        argument?: string;
        value?: string;
        context?: Record<string, string>;
      };
      if (refType !== "prompt" && refType !== "resource")
        return send(400, { error: "refType must be 'prompt' or 'resource'" });
      if (typeof ref !== "string")
        return send(400, { error: "missing `ref`" });
      if (typeof argument !== "string")
        return send(400, { error: "missing `argument`" });

      const refObj =
        refType === "prompt"
          ? ({ type: "ref/prompt" as const, name: ref })
          : ({ type: "ref/resource" as const, uri: ref });
      const params: Parameters<Session["client"]["complete"]>[0] = {
        ref: refObj,
        argument: { name: argument, value: value ?? "" },
      };
      if (context && Object.keys(context).length > 0) {
        (params as { context?: { arguments: Record<string, string> } }).context = {
          arguments: context,
        };
      }
      const r = await session.client.complete(params);
      return send(200, r);
    }
    if (sub === "disconnect" && method === "POST") {
      await ctx.sessions.release(name, true);
      return send(200, { ok: true });
    }

    return send(404, { error: `unknown route: ${method} ${urlPath}` });
  } catch (e) {
    return send(500, { error: (e as Error).message });
  }
}

/* ------------------------------------------------------------------ */
/* Action helpers                                                      */
/* ------------------------------------------------------------------ */

async function actionDiscover(session: Session) {
  const caps = session.client.getServerCapabilities() ?? {};
  const info = session.client.getServerVersion() ?? null;

  const [resources, templates, tools, prompts] = await Promise.all([
    caps.resources
      ? safe(() => session.client.listResources()).then((r) => r?.resources ?? [])
      : Promise.resolve([]),
    caps.resources
      ? safe(() => session.client.listResourceTemplates()).then(
          (r) => r?.resourceTemplates ?? [],
        )
      : Promise.resolve([]),
    caps.tools
      ? safe(() => session.client.listTools()).then((r) => r?.tools ?? [])
      : Promise.resolve([]),
    caps.prompts
      ? safe(() => session.client.listPrompts()).then((r) => r?.prompts ?? [])
      : Promise.resolve([]),
  ]);

  return {
    server: info,
    capabilities: caps,
    resources,
    resourceTemplates: templates,
    tools,
    prompts,
  };
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/**
 * On-disk view of the user's .mcp.json files, shaped for the dashboard's
 * `/api/servers` endpoint.
 */
function summarizeServers(config: LoadedConfig) {
  return {
    sources: config.sources.map((s) => ({
      path: s.path,
      serverCount: Object.keys(s.servers).length,
    })),
    errors: config.errors,
    servers: Array.from(config.servers.entries()).map(([name, { config: cfg, source }]) => {
      const isHttp = "url" in cfg;
      return {
        name,
        source,
        transport: (cfg.type ??
          (isHttp ? "http" : "stdio")) as
          | "stdio"
          | "http"
          | "sse"
          | "streamable-http",
        target: isHttp ? cfg.url : `${cfg.command} ${(cfg.args ?? []).join(" ")}`.trim(),
        ...(isHttp
          ? { headers: cfg.headers }
          : { args: cfg.args, env: cfg.env, cwd: cfg.cwd }),
      };
    }),
  };
}

async function readAuthStatus(name: string) {
  const spec = parseTarget(name);
  const id = targetId(spec);
  const file = authFile(id);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as {
      tokens?: { token_type?: string; refresh_token?: string; scope?: string };
      clientInformation?: unknown;
    };
    return {
      file,
      exists: true,
      hasTokens: !!parsed.tokens,
      hasRefreshToken: !!parsed.tokens?.refresh_token,
      hasClientInfo: !!parsed.clientInformation,
      tokenType: parsed.tokens?.token_type,
      scope: parsed.tokens?.scope,
    };
  } catch (e) {
    if (isENOENT(e)) return { file, exists: false };
    throw e;
  }
}

async function deleteAuthFile(name: string) {
  const spec = parseTarget(name);
  const id = targetId(spec);
  const file = authFile(id);
  try {
    await fs.unlink(file);
    return { removed: true, file };
  } catch (e) {
    if (isENOENT(e)) return { removed: false, file };
    throw e;
  }
}

function looksLikeRawTarget(name: string): boolean {
  // Allow an HTTP URL or a quoted stdio command in the :name segment, so the
  // UI can address a server that isn't in .mcp.json.
  return /^https?:\/\//.test(name) || /\s/.test(name);
}

/* ------------------------------------------------------------------ */
/* Static file handler                                                 */
/* ------------------------------------------------------------------ */

async function serveStatic(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  urlPath: string,
  staticDir: string,
): Promise<void> {
  // Resolve, then guard against path-traversal.
  const safePath = path.posix.normalize(urlPath).replace(/^\/+/, "");
  const resolved = path.resolve(staticDir, safePath);
  if (!resolved.startsWith(path.resolve(staticDir))) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }

  const candidates =
    safePath === "" || safePath.endsWith("/")
      ? [path.join(resolved, "index.html")]
      : [resolved, path.join(staticDir, "index.html")];

  for (const file of candidates) {
    if (await fileExists(file)) {
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        "content-type": MIME[ext] ?? "application/octet-stream",
        ...(ext === ".html"
          ? { "cache-control": "no-cache" }
          : { "cache-control": "public, max-age=3600" }),
      });
      createReadStream(file).pipe(res);
      return;
    }
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}

/* ------------------------------------------------------------------ */
/* Session pool                                                        */
/* ------------------------------------------------------------------ */

class SessionPool {
  #entries = new Map<
    string,
    {
      session: Session | null;
      pending: Promise<Session> | null;
      lastUsed: number;
      timer: NodeJS.Timeout | null;
    }
  >();

  async acquire(name: string): Promise<Session> {
    let entry = this.#entries.get(name);
    if (!entry) {
      entry = { session: null, pending: null, lastUsed: Date.now(), timer: null };
      this.#entries.set(name, entry);
    }

    entry.lastUsed = Date.now();
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.release(name, true), SESSION_IDLE_MS);

    if (entry.session) return entry.session;
    if (entry.pending) return entry.pending;

    entry.pending = connect(name)
      .then((s) => {
        entry!.session = s;
        entry!.pending = null;
        return s;
      })
      .catch((err) => {
        entry!.pending = null;
        throw err;
      });

    return entry.pending;
  }

  async release(name: string, hard = false): Promise<void> {
    const entry = this.#entries.get(name);
    if (!entry) return;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (hard) {
      const s = entry.session;
      entry.session = null;
      this.#entries.delete(name);
      if (s) await s.close();
    }
  }

  async closeAll(): Promise<void> {
    const all = Array.from(this.#entries.keys());
    for (const name of all) await this.release(name, true);
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function corsHeaders() {
  // Permissive — the API is bound to loopback by default.
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  };
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders(),
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error(`invalid JSON body: ${(e as Error).message}`));
      }
    });
    req.on("error", reject);
  });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

function isENOENT(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "ENOENT"
  );
}
