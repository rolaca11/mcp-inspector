import { app, BrowserWindow, Menu, protocol } from "electron";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { connect, type Session } from "@rolaca11/mcp-inspector-core/client";
import { loadConfigSync } from "@rolaca11/mcp-inspector-core/config";
import { setLoadedConfig } from "@rolaca11/mcp-inspector-core/target";
import { appRouter } from "@rolaca11/mcp-inspector-core/trpc/router";

// Packaged Electron apps launched from a desktop environment inherit a minimal
// PATH that is missing user-installed tools (node, npx, etc.) which are often
// set up in .bashrc (nvm, fnm, volta). We run the user's shell interactively
// to pick up those additions, using a marker so we can extract PATH from any
// other output the shell may produce.
if (app.isPackaged && process.platform !== "win32") {
  try {
    const shell = process.env.SHELL || "/bin/bash";
    const marker = `__mcp_path_${process.pid}__`;
    const out = execFileSync(
      shell,
      ["-i", "-c", `echo "${marker}\${PATH}${marker}"`],
      { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    );
    const m = out.match(new RegExp(`${marker}(.+?)${marker}`));
    if (m?.[1]) process.env.PATH = m[1];
  } catch {
    // Keep the existing PATH if the shell fails.
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCHEME = "app";
const HOST = "inspector";
const SESSION_IDLE_MS = 5 * 60 * 1000;

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

/* ------------------------------------------------------------------ */
/* Custom scheme — must be registered before app is ready              */
/* ------------------------------------------------------------------ */

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

/* ------------------------------------------------------------------ */
/* Session pool (same contract as the CLI server)                      */
/* ------------------------------------------------------------------ */

const pendingAuthUrls = new Map<string, string>();

class SessionPool {
  #entries = new Map<
    string,
    {
      session: Session | null;
      pending: Promise<Session> | null;
      lastUsed: number;
      timer: ReturnType<typeof setTimeout> | null;
    }
  >();

  async acquire(name: string): Promise<Session> {
    let entry = this.#entries.get(name);
    if (!entry) {
      entry = {
        session: null,
        pending: null,
        lastUsed: Date.now(),
        timer: null,
      };
      this.#entries.set(name, entry);
    }

    entry.lastUsed = Date.now();
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(
      () => void this.release(name, true),
      SESSION_IDLE_MS,
    );

    if (entry.session) return entry.session;
    if (entry.pending) return entry.pending;

    entry.pending = connect(name, {
      onRedirect: (url) => {
        pendingAuthUrls.set(name, url.toString());
      },
    })
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
/* App lifecycle                                                       */
/* ------------------------------------------------------------------ */

let activeSessions: SessionPool | null = null;

function resolveWebDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "web");
  }
  return path.resolve(__dirname, "../../web/dist");
}

async function createWindow(): Promise<void> {
  const configOpts = {};
  const initial = loadConfigSync(configOpts);
  setLoadedConfig(initial);

  const sessions = new SessionPool();
  activeSessions = sessions;

  const webDir = resolveWebDir();

  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/api/trpc" || pathname.startsWith("/api/trpc/")) {
      return fetchRequestHandler({
        endpoint: "/api/trpc",
        req: request,
        router: appRouter,
        createContext: () => ({ sessions, pendingAuthUrls, configOpts }),
      });
    }

    const safePath =
      pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const absPath = path.resolve(webDir, safePath);

    if (!absPath.startsWith(path.resolve(webDir))) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const data = await fs.readFile(absPath);
      const ext = path.extname(absPath).toLowerCase();
      return new Response(data, {
        headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
      });
    } catch {
      const index = await fs.readFile(path.join(webDir, "index.html"));
      return new Response(index, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  });

  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    backgroundColor: "#09090b",
    icon: path.join(__dirname, "../build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.on("did-finish-load", () => {
    void win.webContents.insertCSS(`
      header {
        -webkit-app-region: drag;
      }
      header button,
      header a,
      header [role="tab"],
      header [role="combobox"],
      header [role="button"] {
        -webkit-app-region: no-drag;
      }
    `);
  });

  win.loadURL(`${SCHEME}://${HOST}/`);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("will-quit", (e) => {
  if (activeSessions) {
    e.preventDefault();
    const pool = activeSessions;
    activeSessions = null;
    pool.closeAll().finally(() => app.quit());
  }
});
