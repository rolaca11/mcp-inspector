import { describe, expect, it } from "vitest";

import { formatJsonText, minifyJsonText } from "@/lib/json-text";

describe("json text helpers", () => {
  it("formats valid JSON with two-space indentation", () => {
    expect(formatJsonText('{"a":[1,2],"b":{"c":null}}')).toBe(
      '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": null\n  }\n}',
    );
  });

  it("minifies valid JSON", () => {
    expect(minifyJsonText('{\n  "a": [ 1, 2 ]\n}')).toBe('{"a":[1,2]}');
  });

  it("returns null for invalid JSON", () => {
    expect(formatJsonText("{a:1}")).toBeNull();
    expect(minifyJsonText("")).toBeNull();
  });
});
