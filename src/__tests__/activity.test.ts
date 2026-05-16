import { describe, it, expect } from "vitest";
import { runActivity, errorActivity } from "../trpc/activity.js";

describe("runActivity", () => {
  it("records successful activity", async () => {
    const result = await runActivity("test-kind", "test-target", async () => ({
      data: "hello",
    }));
    expect(result.kind).toBe("test-kind");
    expect(result.target).toBe("test-target");
    expect(result.outcome).toBe("ok");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.result).toEqual({ data: "hello" });
    expect(result.error).toBeUndefined();
  });

  it("measures duration", async () => {
    const result = await runActivity("test", "target", async () => {
      await new Promise((r) => setTimeout(r, 50));
      return "done";
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(30);
  });

  it("records failed activity without throwing", async () => {
    const result = await runActivity("test", "target", async () => {
      throw new Error("something went wrong");
    });
    expect(result.outcome).toBe("error");
    expect(result.error).toBe("something went wrong");
    expect(result.result).toBeUndefined();
    expect(result.tokenCount).toBeNull();
  });

  it("counts tokens on success", async () => {
    const result = await runActivity(
      "test",
      "target",
      async () => "hello world this is a test",
    );
    expect(result.outcome).toBe("ok");
    expect(result.tokenCount).toBeGreaterThan(0);
  });

  it("sets tokenCount to null on error", async () => {
    const result = await runActivity("test", "target", async () => {
      throw new Error("fail");
    });
    expect(result.tokenCount).toBeNull();
  });
});

describe("errorActivity", () => {
  it("creates error activity with zero duration", () => {
    const result = errorActivity("test-kind", "test-target", "something failed");
    expect(result).toEqual({
      kind: "test-kind",
      target: "test-target",
      outcome: "error",
      durationMs: 0,
      tokenCount: null,
      error: "something failed",
    });
  });

  it("has no result property", () => {
    const result = errorActivity("k", "t", "e");
    expect(result.result).toBeUndefined();
  });
});
