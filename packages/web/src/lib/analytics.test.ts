import { describe, expect, it } from "vitest";
import type { CaptureResult } from "posthog-js";

import { redactEvent, redactPath, redactUrl } from "./analytics";

const APP = "app://inspector";

describe("redactPath", () => {
  it("replaces the server segment and keeps the page", () => {
    expect(redactPath("/acme-internal/tools")).toBe("/:server/tools");
    expect(redactPath("/acme-internal")).toBe("/:server");
    expect(redactPath("/")).toBe("/");
  });
});

describe("redactUrl", () => {
  it("redacts in-app URLs and drops the query and hash", () => {
    expect(redactUrl("app://inspector/acme/resources?uri=secret#x", APP)).toBe(
      "app://inspector/:server/resources",
    );
    expect(
      redactUrl("http://127.0.0.1:8765/acme/auth", "http://127.0.0.1:8765"),
    ).toBe("http://127.0.0.1:8765/:server/auth");
  });

  it("redacts bare paths", () => {
    expect(redactUrl("/acme/prompts?x=1", APP)).toBe("/:server/prompts");
  });

  it("leaves external URLs and markers alone", () => {
    expect(redactUrl("https://example.com/a/b", APP)).toBe(
      "https://example.com/a/b",
    );
    expect(redactUrl("$direct", APP)).toBe("$direct");
  });
});

describe("redactEvent", () => {
  it("redacts URL properties in properties, $set and $set_once", () => {
    const event = {
      uuid: "1",
      event: "$pageview",
      properties: {
        $current_url: "app://inspector/acme/tools",
        $pathname: "/acme/tools",
        $prev_pageview_pathname: "/acme/overview",
        $referrer: "$direct",
        title: "MCP Inspector",
      },
      $set: { $current_url: "app://inspector/acme/tools" },
      $set_once: { $initial_current_url: "app://inspector/acme/overview" },
    } as unknown as CaptureResult;

    const result = redactEvent(event, APP)!;
    expect(result.properties).toMatchObject({
      $current_url: "app://inspector/:server/tools",
      $pathname: "/:server/tools",
      $prev_pageview_pathname: "/:server/overview",
      $referrer: "$direct",
      title: "MCP Inspector",
    });
    expect(result.$set).toEqual({ $current_url: "app://inspector/:server/tools" });
    expect(result.$set_once).toEqual({
      $initial_current_url: "app://inspector/:server/overview",
    });
  });

  it("passes null through", () => {
    expect(redactEvent(null, APP)).toBeNull();
  });
});
