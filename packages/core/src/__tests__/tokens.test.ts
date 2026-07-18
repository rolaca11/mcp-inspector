import { describe, it, expect } from "vitest";
import { countResponseTokens, MAX_TOKENIZE_CHARS } from "../tokens.js";

describe("countResponseTokens", () => {
  it("counts tokens for a string", () => {
    const result = countResponseTokens("hello world");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens).toBeGreaterThan(0);
    }
  });

  it("counts tokens for an object (JSON-serialized)", () => {
    const result = countResponseTokens({ key: "value", nested: { a: 1 } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens).toBeGreaterThan(0);
    }
  });

  it("returns 0 tokens for empty string", () => {
    const result = countResponseTokens("");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens).toBe(0);
    }
  });

  it("counts tokens for an array", () => {
    const result = countResponseTokens([1, 2, 3]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens).toBeGreaterThan(0);
    }
  });

  it("counts tokens for null", () => {
    const result = countResponseTokens(null);
    expect(result.ok).toBe(true);
  });

  it("skips oversized payloads instead of tokenizing them", () => {
    // e.g. a base64 audio blob from a resource read — tokenizing it
    // would block the event loop for seconds.
    const blob = "A".repeat(MAX_TOKENIZE_CHARS + 1);
    const result = countResponseTokens({
      contents: [{ uri: "daw://clip", mimeType: "audio/wav", blob }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("too-large");
    }
  });

  it("still tokenizes payloads at the cap boundary", () => {
    const result = countResponseTokens("a".repeat(1000));
    expect(result.ok).toBe(true);
  });

  it("longer text produces more tokens", () => {
    const short = countResponseTokens("hi");
    const long = countResponseTokens(
      "This is a much longer sentence with many more words and tokens",
    );
    expect(short.ok && long.ok).toBe(true);
    if (short.ok && long.ok) {
      expect(long.tokens).toBeGreaterThan(short.tokens);
    }
  });
});
