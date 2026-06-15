/**
 * `mcp-inspector serve` — boots the dashboard.
 *
 * The same process that holds long-lived MCP sessions also serves the static
 * UI bundle (`dist/web/`) and a tRPC API. The CLI and the web view talk to
 * one client implementation; there is no second process.
 *
 * Sessions live in the shared core session pool (idle-evicted, self-healing
 * on session expiry). They are always closed on process exit so child stdio
 * processes are reaped.
 */

import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import pc from "picocolors";

import { createSessionPool } from "@rolaca11/mcp-inspector-core/session-pool";
import {
  ensureInspectorConfig,
  loadConfigSync,
} from "@rolaca11/mcp-inspector-core/config";
import { errorMessage } from "@rolaca11/mcp-inspector-core/format";
import { setLoadedConfig } from "@rolaca11/mcp-inspector-core/target";
import { appRouter } from "@rolaca11/mcp-inspector-core/trpc/router";

/* ------------------------------------------------------------------ */
/* Pending auth URLs (serve-mode: sent to the web UI instead of        */
/* launching the OS default browser)                                   */
/* ------------------------------------------------------------------ */

const pendingAuthUrls = new Map<string, string>();

/* ------------------------------------------------------------------ */
/* Types and constants                                                 */
/* ------------------------------------------------------------------ */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_STATIC_DIR = path.resolve(__dirname, "./web");
const DEV_STATIC_DIR = path.resolve(__dirname, "../../web/dist");

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
  quiet?: boolean;
  noUi?: boolean;
  staticDir?: string;
  configFile?: string | string[];
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

  const extraFiles = Array.isArray(opts.configFile)
    ? opts.configFile
    : opts.configFile
      ? [opts.configFile]
      : [];
  const configOpts = extraFiles.length > 0 ? { extraFiles } : {};
  ensureInspectorConfig();
  const initial = loadConfigSync(configOpts);
  setLoadedConfig(initial);

  const sessions = createSessionPool({
    onAuthRedirect: (name, url) => pendingAuthUrls.set(name, url.toString()),
  });

  const trpcHandler = createHTTPHandler({
    router: appRouter,
    basePath: "/api/trpc/",
    createContext: () => ({ sessions, pendingAuthUrls, configOpts }),
    responseMeta: () => ({
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type,authorization",
      },
    }),
  });

  const staticDir =
    opts.staticDir ??
    ((await dirExists(DEFAULT_STATIC_DIR))
      ? DEFAULT_STATIC_DIR
      : DEV_STATIC_DIR);
  const staticAvailable = !opts.noUi && (await dirExists(staticDir));

  const server = http.createServer((req, res) =>
    handle(req, res, { staticDir, staticAvailable, trpcHandler }).catch(
      (err) => {
        console.error(pc.red("[serve] unhandled:"), err);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: errorMessage(err) }));
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
    console.error(`  ${pc.dim("api:")}       ${pc.cyan(`${url}/api/trpc`)}`);
    if (!staticAvailable && !opts.noUi) {
      console.error(
        pc.yellow(
          `  warning: ${staticDir} not found — UI not served. Run \`bun run build:web\` or use \`--no-ui\`.`,
        ),
      );
    }
    if (initial.errors.length > 0) {
      for (const err of initial.errors) {
        console.error(
          pc.yellow(`  config warning: ${err.path}: ${err.message}`),
        );
      }
    }
  }

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
  staticDir: string;
  staticAvailable: boolean;
  trpcHandler: http.RequestListener;
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: HandlerCtx,
): Promise<void> {
  const urlPath = (req.url ?? "/").split("?")[0] ?? "/";

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    });
    res.end();
    return;
  }

  if (urlPath === "/api/trpc" || urlPath.startsWith("/api/trpc/")) {
    ctx.trpcHandler(req, res);
    return;
  }

  if (urlPath === "/api" || urlPath.startsWith("/api/")) {
    sendJson(res, 404, {
      error: "not found",
      message: "The inspector API is served under /api/trpc.",
    });
    return;
  }

  if (!ctx.staticAvailable) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(
      "UI not built. Run `bun run build:web` or pass `--no-ui` to serve only /api/trpc.",
    );
    return;
  }

  return serveStatic(req, res, urlPath, ctx.staticDir);
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
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function corsHeaders() {
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
