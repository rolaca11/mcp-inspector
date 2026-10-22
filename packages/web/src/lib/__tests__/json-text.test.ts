import { describe, expect, it } from "vitest";

import { formatJsonText, jsonValueText, minifyJsonText } from "@/lib/json-text";

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

  it("copies strings without quotes and scalars as their literal", () => {
    expect(jsonValueText("https://example.com")).toBe("https://example.com");
    expect(jsonValueText(42)).toBe("42");
    expect(jsonValueText(false)).toBe("false");
    expect(jsonValueText(null)).toBe("null");
  });

  it("copies objects and arrays as indented JSON", () => {
    expect(jsonValueText({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(jsonValueText([])).toBe("[]");
  });
});
