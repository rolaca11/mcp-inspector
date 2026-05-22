import { describe, expect, it } from "vitest";

import { appendConfigFiles } from "../config-files.js";

describe("appendConfigFiles", () => {
  it("appends one config file", () => {
    expect(appendConfigFiles("project.mcp.json", [])).toEqual([
      "project.mcp.json",
    ]);
  });

  it("supports comma-separated config files", () => {
    expect(appendConfigFiles("a.json, b.json,,c.json", [])).toEqual([
      "a.json",
      "b.json",
      "c.json",
    ]);
  });

  it("preserves config files from repeated options", () => {
    expect(appendConfigFiles("b.json", ["a.json"])).toEqual([
      "a.json",
      "b.json",
    ]);
  });
});
