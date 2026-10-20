import { app, BrowserWindow, Menu, protocol } from "electron";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import {
  createSessionPool,
  type SessionPool,
} from "@rolaca11/mcp-inspector-core/session-pool";
import {
  ensureInspectorConfig,
  loadConfigSync,
  type LoadConfigOptions,
} from "@rolaca11/mcp-inspector-core/config";
import { setLoadedConfig } from "@rolaca11/mcp-inspector-core/target";
import { appRouter } from "@rolaca11/mcp-inspector-core/trpc/router";
import {
  DESKTOP_SCHEME,
  readDesktopLaunchOptions,
  type DesktopLaunchOptions,
} from "@rolaca11/mcp-inspector-core/desktop";

let launchOptions = parseLaunchOptions(process.argv);
let configOpts: LoadConfigOptions = {};
let mainWindow: BrowserWindow | null = null;
let launchQueue: Promise<void> = Promise.resolve();

function parseLaunchOptions(args: string[]): DesktopLaunchOptions | undefined {
  try {
    return readDesktopLaunchOptions(args);
  } catch (error) {
    console.error("Invalid desktop launch configuration:", error);
    return undefined;
  }
}

function focusWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function receiveLaunch(args: string[]): void {
  const options = parseLaunchOptions(args);
  if (!app.isReady()) {
    if (options) launchOptions = options;
    return;
  }
  launchQueue = launchQueue.then(async () => {
    if (options) {
      await activeSessions?.closeAll();
      pendingAuthUrls.clear();
      launchOptions = options;
      loadLaunchConfig();
      if (mainWindow) await mainWindow.loadURL(`${SCHEME}://${HOST}/`);
    }
    if (!mainWindow) await createWindow();
    focusWindow();
  }).catch((error) => console.error("Could not open desktop configuration:", error));
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  receiveLaunch([url]);
});
app.on("second-instance", (_event, args) => receiveLaunch(args));

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
/* Session pool (shared with the CLI server, see core/session-pool)    */
/* ------------------------------------------------------------------ */

const pendingAuthUrls = new Map<string, string>();

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

function loadLaunchConfig(): void {
  if (launchOptions) process.chdir(launchOptions.cwd);
  configOpts = launchOptions
    ? { cwd: launchOptions.cwd, extraFiles: launchOptions.extraFiles }
    : {};
  ensureInspectorConfig();
  const initial = loadConfigSync(configOpts);
  setLoadedConfig(initial);
  if (!launchOptions?.quiet && !process.env.MCPI_QUIET_CONFIG) {
    for (const error of initial.errors) {
      console.error(`config warning: ${error.path}: ${error.message}`);
    }
  }
}

async function createWindow(): Promise<void> {
  loadLaunchConfig();
  const registerProtocol = !activeSessions;
  const sessions = activeSessions ?? createSessionPool({
    onAuthRedirect: (name, url) => pendingAuthUrls.set(name, url.toString()),
  });
  activeSessions = sessions;

  const webDir = resolveWebDir();

  if (registerProtocol) protocol.handle(SCHEME, async (request) => {
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
  mainWindow = win;
  win.on("closed", () => { mainWindow = null; });

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

  await win.loadURL(`${SCHEME}://${HOST}/`);
}

if (app.requestSingleInstanceLock()) {
  if (app.isPackaged) app.setAsDefaultProtocolClient(DESKTOP_SCHEME);
  launchQueue = app.whenReady().then(createWindow);
} else {
  app.quit();
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  receiveLaunch([]);
});

app.on("will-quit", (e) => {
  if (activeSessions) {
    e.preventDefault();
    const pool = activeSessions;
    activeSessions = null;
    pool.closeAll().finally(() => app.quit());
  }
});
