import { describe, it, expect } from "vitest";

import {
  UI_EXTENSION_ID,
  UI_RESOURCE_MIME_TYPE,
  uiClientExtensions,
  toolUiResourceUri,
  toolHasUi,
  toolVisibility,
  resourceUiMeta,
  uiRenderKind,
  isUiResourceUri,
  isRenderableUiResource,
} from "../apps.js";

describe("uiClientExtensions", () => {
  it("advertises the UI extension with the app MIME type", () => {
    const ext = uiClientExtensions();
    expect(ext[UI_EXTENSION_ID]).toEqual({
      mimeTypes: [UI_RESOURCE_MIME_TYPE],
    });
  });
});

describe("toolUiResourceUri", () => {
  it("reads the canonical nested key", () => {
    expect(
      toolUiResourceUri({ ui: { resourceUri: "ui://srv/app" } }),
    ).toBe("ui://srv/app");
  });

  it("reads the deprecated flat key", () => {
    expect(toolUiResourceUri({ "ui/resourceUri": "ui://srv/flat" })).toBe(
      "ui://srv/flat",
    );
  });

  it("reads the OpenAI Apps SDK key", () => {
    expect(
      toolUiResourceUri({ "openai/outputTemplate": "ui://widget/x" }),
    ).toBe("ui://widget/x");
  });

  it("prefers the nested key over the legacy ones", () => {
    expect(
      toolUiResourceUri({
        ui: { resourceUri: "ui://nested" },
        "ui/resourceUri": "ui://flat",
        "openai/outputTemplate": "ui://openai",
      }),
    ).toBe("ui://nested");
  });

  it("returns undefined when there is no link or bad shapes", () => {
    expect(toolUiResourceUri(undefined)).toBeUndefined();
    expect(toolUiResourceUri({})).toBeUndefined();
    expect(toolUiResourceUri({ ui: "nope" })).toBeUndefined();
    expect(toolUiResourceUri({ ui: { resourceUri: 42 } })).toBeUndefined();
  });

  it("toolHasUi mirrors presence of a link", () => {
    expect(toolHasUi({ ui: { resourceUri: "ui://x" } })).toBe(true);
    expect(toolHasUi({})).toBe(false);
  });
});

describe("toolVisibility", () => {
  it("defaults to both model and app", () => {
    expect(toolVisibility(undefined)).toEqual(["model", "app"]);
    expect(toolVisibility({ ui: {} })).toEqual(["model", "app"]);
  });

  it("returns the declared visibility, filtering junk", () => {
    expect(toolVisibility({ ui: { visibility: ["app"] } })).toEqual(["app"]);
    expect(
      toolVisibility({ ui: { visibility: ["model", "bogus"] } }),
    ).toEqual(["model"]);
  });
});

describe("resourceUiMeta", () => {
  it("normalizes spec camelCase CSP, permissions, domain, border", () => {
    const meta = resourceUiMeta({
      ui: {
        csp: {
          connectDomains: ["https://api.example.com"],
          resourceDomains: ["https://cdn.example.com"],
        },
        permissions: { camera: {}, clipboardWrite: {} },
        domain: "abc.host.com",
        prefersBorder: true,
      },
    });
    expect(meta?.csp?.connectDomains).toEqual(["https://api.example.com"]);
    expect(meta?.csp?.resourceDomains).toEqual(["https://cdn.example.com"]);
    expect(meta?.permissions).toEqual({
      camera: true,
      microphone: false,
      geolocation: false,
      clipboardWrite: true,
    });
    expect(meta?.domain).toBe("abc.host.com");
    expect(meta?.prefersBorder).toBe(true);
  });

  it("folds OpenAI snake_case CSP + widget aliases", () => {
    const meta = resourceUiMeta({
      "openai/widgetCSP": {
        connect_domains: ["https://api.openai.test"],
        resource_domains: ["https://cdn.openai.test"],
      },
      "openai/widgetPrefersBorder": true,
      "openai/widgetDomain": "x.oaiusercontent.com",
    });
    expect(meta?.csp?.connectDomains).toEqual(["https://api.openai.test"]);
    expect(meta?.csp?.resourceDomains).toEqual(["https://cdn.openai.test"]);
    expect(meta?.prefersBorder).toBe(true);
    expect(meta?.domain).toBe("x.oaiusercontent.com");
  });

  it("returns undefined when there is nothing to surface", () => {
    expect(resourceUiMeta(undefined)).toBeUndefined();
    expect(resourceUiMeta({})).toBeUndefined();
    expect(resourceUiMeta({ ui: {} })).toBeUndefined();
  });
});

describe("uiRenderKind", () => {
  it("maps the MCP Apps MIME type to html", () => {
    expect(uiRenderKind(UI_RESOURCE_MIME_TYPE)).toBe("html");
  });

  it("maps legacy mcp-ui and OpenAI MIME types", () => {
    expect(uiRenderKind("text/html")).toBe("html");
    expect(uiRenderKind("text/html+skybridge")).toBe("html");
    expect(uiRenderKind("text/uri-list")).toBe("url");
    expect(
      uiRenderKind("application/vnd.mcp-ui.remote-dom+javascript; framework=react"),
    ).toBe("remote-dom");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(uiRenderKind("  TEXT/HTML;profile=mcp-app ")).toBe("html");
  });

  it("falls back to html for a ui:// uri with no MIME type", () => {
    expect(uiRenderKind(undefined, "ui://srv/app")).toBe("html");
    expect(uiRenderKind(undefined, "https://example.com")).toBeNull();
    expect(uiRenderKind(undefined, undefined)).toBeNull();
  });

  it("returns null for unrelated MIME types", () => {
    expect(uiRenderKind("application/json")).toBeNull();
    expect(uiRenderKind("image/png")).toBeNull();
  });
});

describe("isUiResourceUri / isRenderableUiResource", () => {
  it("detects the ui:// scheme", () => {
    expect(isUiResourceUri("ui://srv/app")).toBe(true);
    expect(isUiResourceUri("https://example.com")).toBe(false);
    expect(isUiResourceUri(undefined)).toBe(false);
  });

  it("treats html and url kinds as renderable, remote-dom as not", () => {
    expect(isRenderableUiResource(UI_RESOURCE_MIME_TYPE)).toBe(true);
    expect(isRenderableUiResource("text/uri-list")).toBe(true);
    expect(
      isRenderableUiResource("application/vnd.mcp-ui.remote-dom+javascript"),
    ).toBe(false);
    expect(isRenderableUiResource("application/json")).toBe(false);
    expect(isRenderableUiResource(undefined, "ui://srv/app")).toBe(true);
  });
});
