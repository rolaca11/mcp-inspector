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
  webContentsListeners: new Map<string, (...args: unknown[]) => void>(),
  handle: vi.fn(),
  loadURL: vi.fn(),
  focus: vi.fn(),
  restore: vi.fn(),
  closeAll: vi.fn(),
  setWindowOpenHandler: vi.fn(),
  openExternal: vi.fn(),
  poolOptions: undefined as { elicitations?: unknown } | undefined,
  windowCount: 0,
  context: undefined as
    | { configOpts: { cwd?: string; extraFiles?: string[] }; elicitations?: unknown }
    | undefined,
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
    webContents = {
      on: (event: string, listener: (...args: unknown[]) => void) => runtime.webContentsListeners.set(event, listener),
      insertCSS: vi.fn(),
      setWindowOpenHandler: runtime.setWindowOpenHandler,
    };
    loadURL = runtime.loadURL;
    isMinimized = () => true;
    restore = runtime.restore;
    show = vi.fn();
    focus = runtime.focus;
  },
  Menu: { setApplicationMenu: vi.fn() },
  shell: { openExternal: runtime.openExternal },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: runtime.handle },
}));
vi.mock("@rolaca11/mcp-inspector-core/config", () => ({
  ensureInspectorConfig: vi.fn(),
  loadConfigSync: vi.fn(() => ({ servers: new Map(), sources: [], errors: [] })),
}));
vi.mock("@rolaca11/mcp-inspector-core/target", () => ({ setLoadedConfig: vi.fn() }));
vi.mock("@rolaca11/mcp-inspector-core/session-pool", () => ({
  createSessionPool: (options: { elicitations?: unknown }) => {
    runtime.poolOptions = options;
    return { closeAll: runtime.closeAll };
  },
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
  runtime.webContentsListeners.clear();
  runtime.windowCount = 0;
  runtime.context = undefined;
  runtime.poolOptions = undefined;
  runtime.openExternal.mockResolvedValue(undefined);
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

  it("opens only http and https window targets in the system browser", async () => {
    await import("../main.js");
    becomeReady();
    await vi.waitFor(() => expect(runtime.setWindowOpenHandler).toHaveBeenCalledOnce());
    const openHandler = runtime.setWindowOpenHandler.mock.calls[0]![0] as (details: { url: string }) => { action: string };
    expect(openHandler({ url: "https://auth.example.com/start" })).toEqual({ action: "deny" });
    expect(openHandler({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
    expect(openHandler({ url: "file:///etc/passwd" })).toEqual({ action: "deny" });
    expect(runtime.openExternal.mock.calls).toEqual([["https://auth.example.com/start"]]);
  });

  it("blocks navigation away from the app origin", async () => {
    await import("../main.js");
    becomeReady();
    await vi.waitFor(() => expect(runtime.webContentsListeners.has("will-navigate")).toBe(true));
    const onNavigate = runtime.webContentsListeners.get("will-navigate")!;

    const externalEvent = { preventDefault: vi.fn() };
    onNavigate(externalEvent, "https://evil.example/phish");
    expect(externalEvent.preventDefault).toHaveBeenCalledOnce();

    const appEvent = { preventDefault: vi.fn() };
    onNavigate(appEvent, "app://inspector/tools");
    expect(appEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("shares one elicitation broker between the session pool and the API and cancels it on quit", async () => {
    await import("../main.js");
    becomeReady();
    await vi.waitFor(() => expect(runtime.loadURL).toHaveBeenCalledOnce());
    const broker = runtime.poolOptions?.elicitations as {
      request(name: string, params: unknown): Promise<unknown>;
      hasPending(name: string): boolean;
    };
    expect(broker).toBeDefined();
    const handler = runtime.handle.mock.calls[0]![1] as (request: Request) => Promise<Response>;
    await handler(new Request("app://inspector/api/trpc/elicitations.pending"));
    expect(runtime.context?.elicitations).toBe(broker);

    const pending = broker.request("srv", { mode: "url", message: "Go", url: "https://x.test" });
    expect(broker.hasPending("srv")).toBe(true);
    runtime.listeners.get("will-quit")!({ preventDefault: vi.fn() });
    await expect(pending).rejects.toThrow("Application quitting");
    expect(broker.hasPending("srv")).toBe(false);
  });

  it("quits a secondary process without creating a window", async () => {
    runtime.lock.mockReturnValue(false);
    await import("../main.js");
    becomeReady();
    expect(runtime.quit).toHaveBeenCalledOnce();
    expect(runtime.windowCount).toBe(0);
  });
});
