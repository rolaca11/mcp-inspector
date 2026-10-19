import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDesktopLaunchOptions } from "@rolaca11/mcp-inspector-core/desktop";
import { launchDesktop } from "../desktop.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs/promises", () => ({ access: vi.fn() }));
vi.mock("node:module", () => ({ createRequire: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(access).mockResolvedValue(undefined);
  vi.mocked(createRequire).mockReturnValue(
    vi.fn(() => "/local/electron") as unknown as NodeJS.Require,
  );
});

afterEach(() => vi.unstubAllEnvs());

describe("desktop launch", () => {
  it("launches the app in the current directory with ordered config files", async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child as unknown as ReturnType<typeof spawn>;
    });
    vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
    await launchDesktop({
      config: ["team.json", "config with spaces/local.json"],
      quiet: true,
    });
    const appDir = path.join(process.cwd(), "packages/electron");
    expect(createRequire).toHaveBeenCalledWith(path.join(appDir, "package.json"));
    const [command, args, options] = vi.mocked(spawn).mock.calls[0]!;
    expect(command).toBe("/local/electron");
    expect(args?.[0]).toBe(appDir);
    expect(readDesktopLaunchOptions(args as string[])).toEqual({
      cwd: process.cwd(),
      extraFiles: [path.resolve("team.json"), path.resolve("config with spaces/local.json")],
      quiet: true,
    });
    expect(options).toMatchObject({ cwd: process.cwd(), detached: true, stdio: "ignore" });
    expect(options?.env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("reports when the app has not been built in the current directory", async () => {
    vi.mocked(access).mockRejectedValue(new Error("missing"));
    await expect(launchDesktop()).rejects.toThrow("bun run build:electron");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("reports missing local Electron dependencies", async () => {
    vi.mocked(createRequire).mockReturnValue(
      vi.fn(() => { throw new Error("MODULE_NOT_FOUND"); }) as unknown as NodeJS.Require,
    );
    await expect(launchDesktop()).rejects.toThrow("bun install");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("reports executable launch failures", async () => {
    const child = new EventEmitter();
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit("error", new Error("EACCES")));
      return child as ReturnType<typeof spawn>;
    });
    await expect(launchDesktop()).rejects.toThrow("EACCES");
  });
});
