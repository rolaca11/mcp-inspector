import { describe, expect, it } from "vitest";

import {
  allowAttr,
  buildSrcDoc,
  cspToString,
  sandboxAttr,
  sandboxPageUrl,
} from "./mcp-apps";

describe("cspToString", () => {
  it("uses a permissive policy when no CSP is declared (so apps render)", () => {
    const csp = cspToString();
    expect(csp).toContain("connect-src https:");
    expect(csp).not.toContain("connect-src 'none'");
    expect(csp).not.toContain("default-src 'none'");
  });

  it("honors a declared CSP strictly (restrictive base + declared domains)", () => {
    const csp = cspToString({ connectDomains: ["https://api.example.com"] });
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("grants in-frame execution primitives even with a declared CSP", () => {
    // Real frameworks (CesiumJS, knockout, wasm, blob workers) need these; the
    // opaque-origin sandbox is what contains them, not the CSP's eval rules.
    const csp = cspToString({ resourceDomains: ["https://cdn.example.com"] });
    expect(csp).toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(csp).toMatch(/script-src[^;]*'wasm-unsafe-eval'/);
    expect(csp).toMatch(/worker-src[^;]*blob:/);
  });

  it("widens connect-src to declared domains (dropping 'none')", () => {
    const csp = cspToString({ connectDomains: ["https://api.example.com"] });
    expect(csp).toContain("connect-src https://api.example.com");
    expect(csp).not.toContain("connect-src 'none'");
  });

  it("adds resource domains to script/style/img sources", () => {
    const csp = cspToString({ resourceDomains: ["https://cdn.example.com"] });
    expect(csp).toMatch(/script-src[^;]*https:\/\/cdn\.example\.com/);
    expect(csp).toMatch(/img-src[^;]*https:\/\/cdn\.example\.com/);
  });

  it("widens frame-src and base-uri when declared", () => {
    const csp = cspToString({
      frameDomains: ["https://frame.example.com"],
      baseUriDomains: ["https://base.example.com"],
    });
    expect(csp).toContain("frame-src https://frame.example.com");
    expect(csp).toContain("base-uri https://base.example.com");
  });
});

describe("buildSrcDoc", () => {
  it("injects a CSP meta right after an existing <head>", () => {
    const out = buildSrcDoc("<html><head><title>x</title></head><body>hi</body></html>");
    expect(out).toMatch(/<head><meta http-equiv="Content-Security-Policy"/i);
    expect(out).toContain("<title>x</title>");
  });

  it("synthesizes a head when the document has none", () => {
    const out = buildSrcDoc("<html><body>hi</body></html>");
    expect(out).toMatch(/<html><head><meta http-equiv="Content-Security-Policy"/i);
  });

  it("wraps a bare fragment into a full document", () => {
    const out = buildSrcDoc("<h1>hello</h1>");
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain("<h1>hello</h1>");
  });

  it("strips a server-supplied CSP meta so the host policy wins", () => {
    const html =
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body></body></html>';
    const out = buildSrcDoc(html, { connectDomains: ["https://api.example.com"] });
    expect(out).not.toContain("default-src *");
    expect(out).toContain("default-src 'none'");
    expect(out).toContain("connect-src https://api.example.com");
  });

  it("reflects declared CSP domains in the injected policy", () => {
    const out = buildSrcDoc("<h1>x</h1>", {
      connectDomains: ["https://api.example.com"],
    });
    expect(out).toContain("connect-src https://api.example.com");
  });
});

describe("sandbox / permissions", () => {
  it("never grants allow-same-origin (keeps an opaque origin)", () => {
    expect(sandboxAttr()).not.toContain("allow-same-origin");
    expect(sandboxAttr()).toContain("allow-scripts");
  });

  it("grants allow-same-origin only for cross-origin content", () => {
    expect(sandboxAttr()).not.toContain("allow-same-origin");
    expect(sandboxAttr({ sameOrigin: true })).toContain("allow-same-origin");
    expect(sandboxAttr({ sameOrigin: true })).toContain("allow-scripts");
  });

  it("maps declared permissions to an allow attribute", () => {
    expect(allowAttr({ permissions: { camera: true, clipboardWrite: true } })).toBe(
      "camera; clipboard-write",
    );
    expect(allowAttr(undefined)).toBeUndefined();
    expect(allowAttr({ permissions: {} })).toBeUndefined();
  });
});

describe("sandboxPageUrl (sibling origin for the sandbox proxy)", () => {
  const orig = (globalThis as { window?: unknown }).window;
  function withLocation(location: Record<string, string>, fn: () => void) {
    (globalThis as { window?: unknown }).window = { location };
    try {
      fn();
    } finally {
      if (orig === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = orig;
    }
  }

  it("swaps 127.0.0.1 ↔ localhost on the same port", () => {
    withLocation(
      { protocol: "http:", hostname: "127.0.0.1", port: "8765" },
      () => expect(sandboxPageUrl()).toBe("http://localhost:8765/mcp-app-sandbox.html"),
    );
    withLocation(
      { protocol: "http:", hostname: "localhost", port: "5173" },
      () => expect(sandboxPageUrl()).toBe("http://127.0.0.1:5173/mcp-app-sandbox.html"),
    );
  });

  it("uses a sibling host for the Electron app: scheme", () => {
    withLocation({ protocol: "app:", hostname: "inspector", port: "" }, () =>
      expect(sandboxPageUrl()).toBe("app://mcp-app-sandbox/mcp-app-sandbox.html"),
    );
  });

  it("returns null when no sibling origin can be derived", () => {
    withLocation(
      { protocol: "https:", hostname: "inspector.example.com", port: "" },
      () => expect(sandboxPageUrl()).toBeNull(),
    );
  });
});
