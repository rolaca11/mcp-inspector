import { describe, it, expect } from "vitest";
import { extractTemplateVars, errorMessage } from "../format.js";

describe("extractTemplateVars", () => {
  it("extracts simple variable", () => {
    expect(extractTemplateVars("/users/{id}")).toEqual(["id"]);
  });

  it("extracts multiple variables", () => {
    expect(extractTemplateVars("/users/{userId}/posts/{postId}")).toEqual([
      "userId",
      "postId",
    ]);
  });

  it("handles RFC 6570 + operator", () => {
    expect(extractTemplateVars("{+path}")).toEqual(["path"]);
  });

  it("handles RFC 6570 # operator", () => {
    expect(extractTemplateVars("{#fragment}")).toEqual(["fragment"]);
  });

  it("handles RFC 6570 ? operator", () => {
    expect(extractTemplateVars("{?query}")).toEqual(["query"]);
  });

  it("handles RFC 6570 & operator", () => {
    expect(extractTemplateVars("{&continuation}")).toEqual(["continuation"]);
  });

  it("handles RFC 6570 / operator", () => {
    expect(extractTemplateVars("{/segments}")).toEqual(["segments"]);
  });

  it("handles RFC 6570 ; operator", () => {
    expect(extractTemplateVars("{;params}")).toEqual(["params"]);
  });

  it("handles RFC 6570 . operator", () => {
    expect(extractTemplateVars("{.ext}")).toEqual(["ext"]);
  });

  it("handles comma-separated variables", () => {
    expect(extractTemplateVars("{?a,b,c}")).toEqual(["a", "b", "c"]);
  });

  it("handles explode modifier (*)", () => {
    expect(extractTemplateVars("{items*}")).toEqual(["items"]);
  });

  it("handles prefix modifier (:N)", () => {
    expect(extractTemplateVars("{name:3}")).toEqual(["name"]);
  });

  it("deduplicates repeated variables", () => {
    expect(extractTemplateVars("{id}/{id}")).toEqual(["id"]);
  });

  it("returns empty array for no variables", () => {
    expect(extractTemplateVars("/users/123")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(extractTemplateVars("")).toEqual([]);
  });

  it("handles complex combined template", () => {
    const vars = extractTemplateVars(
      "https://api.example.com/{version}/users/{userId}{?fields,limit}",
    );
    expect(vars).toEqual(["version", "userId", "fields", "limit"]);
  });
});

describe("errorMessage", () => {
  it("extracts message from Error", () => {
    expect(errorMessage(new Error("something broke"))).toBe("something broke");
  });

  it("chains nested causes", () => {
    const inner = new Error("root cause");
    const outer = new Error("wrapper", { cause: inner });
    expect(errorMessage(outer)).toBe("wrapper: root cause");
  });

  it("chains deeply nested causes", () => {
    const deep = new Error("deep");
    const mid = new Error("mid", { cause: deep });
    const top = new Error("top", { cause: mid });
    expect(errorMessage(top)).toBe("top: mid: deep");
  });

  it('returns "unknown error" for non-Error values', () => {
    expect(errorMessage(null)).toBe("unknown error");
    expect(errorMessage(undefined)).toBe("unknown error");
    expect(errorMessage(42)).toBe("unknown error");
    expect(errorMessage("string error")).toBe("unknown error");
  });

  it("deduplicates identical messages in chain", () => {
    const inner = new Error("same message");
    const outer = new Error("same message", { cause: inner });
    expect(errorMessage(outer)).toBe("same message");
  });

  it("handles Error with empty message", () => {
    expect(errorMessage(new Error(""))).toBe("unknown error");
  });
});
