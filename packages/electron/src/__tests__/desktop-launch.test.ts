import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfigSync } from "@rolaca11/mcp-inspector-core/config";
import { desktopLaunchUrl } from "@rolaca11/mcp-inspector-core/desktop";

vi.mock("../system-certificates.js", () => ({}));

const runtime = vi.hoisted(() => ({
  ready: false,
  readyResolve: () => {},
  whenReady: vi.fn(),
  lock: vi.fn(),
  quit: vi.fn(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
  windowListeners: new Map<string, () => void>(),
  handle: vi.fn(),
  loadURL: vi.fn(),
  focus: vi.fn(),
  restore: vi.fn(),
  closeAll: vi.fn(),
  windowCount: 0,
  context: undefined as { configOpts: { cwd?: string; extraFiles?: string[] } } | undefined,
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    isReady: () => runtime.ready,
    whenReady: runtime.whenReady,
    requestSingleInstanceLock: runtime.lock,
    quit: runtime.quit,
    on: (event: string, listener: (...args: unknown[]) => void) => runtime.listeners.set(event, listener),
  },
  BrowserWindow: class {
    constructor() { runtime.windowCount++; }
    on(event: string, listener: () => void) { runtime.windowListeners.set(event, listener); }
    webContents = { on: vi.fn(), insertCSS: vi.fn() };
    loadURL = runtime.loadURL;
    isMinimized = () => true;
    restore = runtime.restore;
    show = vi.fn();
    focus = runtime.focus;
  },
  Menu: { setApplicationMenu: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: runtime.handle },
}));
vi.mock("@rolaca11/mcp-inspector-core/config", () => ({
  ensureInspectorConfig: vi.fn(),
  loadConfigSync: vi.fn(() => ({ servers: new Map(), sources: [], errors: [] })),
}));
vi.mock("@rolaca11/mcp-inspector-core/target", () => ({ setLoadedConfig: vi.fn() }));
vi.mock("@rolaca11/mcp-inspector-core/session-pool", () => ({
  createSessionPool: () => ({ closeAll: runtime.closeAll }),
}));
vi.mock("@rolaca11/mcp-inspector-core/trpc/router", () => ({ appRouter: {} }));
vi.mock("@trpc/server/adapters/fetch", () => ({
  fetchRequestHandler: ({ createContext }: { createContext: () => NonNullable<typeof runtime.context> }) => {
    runtime.context = createContext();
    return new Response("{}");
  },
}));

let originalArgv: string[];

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  runtime.ready = false;
  runtime.listeners.clear();
  runtime.windowListeners.clear();
  runtime.windowCount = 0;
  runtime.context = undefined;
  runtime.lock.mockReturnValue(true);
  runtime.loadURL.mockResolvedValue(undefined);
  runtime.closeAll.mockResolvedValue(undefined);
  runtime.whenReady.mockReturnValue(new Promise<void>((resolve) => {
    runtime.readyResolve = resolve;
  }));
  vi.spyOn(process, "chdir").mockImplementation(() => {});
  originalArgv = process.argv;
  process.argv = ["electron", "main.js"];
});

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
});

function becomeReady(): void {
  runtime.ready = true;
  runtime.readyResolve();
}

const config = {
  cwd: "/projects/example",
  extraFiles: ["/projects/example/team config.json"],
  quiet: true,
};

describe("OS desktop launches", () => {
  it("loads a launch URL supplied at process startup", async () => {
    process.argv.push(desktopLaunchUrl(config));
    await import("../main.js");
    becomeReady();
    await vi.waitFor(() => expect(runtime.loadURL).toHaveBeenCalledOnce());
    expect(process.chdir).toHaveBeenCalledWith(config.cwd);
    expect(loadConfigSync).toHaveBeenLastCalledWith({ cwd: config.cwd, extraFiles: config.extraFiles });
  });

  it("captures a macOS open-url event before the app is ready", async () => {
    await import("../main.js");
    const preventDefault = vi.fn();
    runtime.listeners.get("open-url")!({ preventDefault }, desktopLaunchUrl(config));
    becomeReady();
    await vi.waitFor(() => expect(runtime.loadURL).toHaveBeenCalledOnce());
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(loadConfigSync).toHaveBeenLastCalledWith({ cwd: config.cwd, extraFiles: config.extraFiles });
  });

  it.each(["second-instance", "open-url"])("updates the running app on %s and retains config paths for API reloads", async (event) => {
    await import("../main.js");
    becomeReady();
    await vi.waitFor(() => expect(runtime.loadURL).toHaveBeenCalledOnce());
    const url = desktopLaunchUrl(config);
    if (event === "second-instance") runtime.listeners.get(event)!({}, ["inspector", url]);
    else runtime.listeners.get(event)!({ preventDefault: vi.fn() }, url);
    await vi.waitFor(() => expect(runtime.loadURL).toHaveBeenCalledTimes(2));
    expect(runtime.closeAll).toHaveBeenCalledOnce();
    expect(runtime.restore).toHaveBeenCalledOnce();
    expect(runtime.focus).toHaveBeenCalledOnce();
    expect(runtime.windowCount).toBe(1);
    expect(runtime.handle).toHaveBeenCalledOnce();
    const handler = runtime.handle.mock.calls[0]![1] as (request: Request) => Promise<Response>;
    await handler(new Request("app://inspector/api/trpc/servers.list"));
    expect(runtime.context?.configOpts).toEqual({ cwd: config.cwd, extraFiles: config.extraFiles });
  });

  it("reuses the protocol handler when recreating a closed window", async () => {
    await import("../main.js");
    becomeReady();
    await vi.waitFor(() => expect(runtime.loadURL).toHaveBeenCalledOnce());
    runtime.windowListeners.get("closed")!();
    runtime.listeners.get("activate")!();
    await vi.waitFor(() => expect(runtime.loadURL).toHaveBeenCalledTimes(2));
    expect(runtime.windowCount).toBe(2);
    expect(runtime.handle).toHaveBeenCalledOnce();
  });

  it("quits a secondary process without creating a window", async () => {
    runtime.lock.mockReturnValue(false);
    await import("../main.js");
    becomeReady();
    expect(runtime.quit).toHaveBeenCalledOnce();
    expect(runtime.windowCount).toBe(0);
  });
});
