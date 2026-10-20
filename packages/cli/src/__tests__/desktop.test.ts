import path from "node:path";
import open from "open";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDesktopLaunchOptions } from "@rolaca11/mcp-inspector-core/desktop";
import { launchDesktop } from "../desktop.js";

vi.mock("open", () => ({ default: vi.fn() }));

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("desktop launch", () => {
  it("uses the OS URL launcher with the current directory and ordered config files", async () => {
    await launchDesktop({
      config: ["team.json", "config with spaces/local.json"],
      quiet: true,
    });
    expect(open).toHaveBeenCalledOnce();
    const [url, options] = vi.mocked(open).mock.calls[0]!;
    expect(url).toMatch(/^mcp-inspector:\/\/launch\?/);
    expect(options).toBeUndefined();
    expect(readDesktopLaunchOptions([url])).toEqual({
      cwd: process.cwd(),
      extraFiles: [path.resolve("team.json"), path.resolve("config with spaces/local.json")],
      quiet: true,
    });
  });

  it("launches with default config sources and logs the request", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await launchDesktop();
    const [url] = vi.mocked(open).mock.calls[0]!;
    expect(readDesktopLaunchOptions([url])).toEqual({
      cwd: process.cwd(), extraFiles: [], quiet: false,
    });
    expect(log).toHaveBeenCalledWith("Requested MCP Inspector desktop app launch.");
  });

  it("suppresses launch messages with quiet", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await launchDesktop({ quiet: true });
    expect(log).not.toHaveBeenCalled();
  });

  it("reports OS launcher failures", async () => {
    vi.mocked(open).mockRejectedValue(new Error("xdg-open unavailable"));
    await expect(launchDesktop()).rejects.toThrow("xdg-open unavailable");
  });
});
