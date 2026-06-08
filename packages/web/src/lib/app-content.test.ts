import { describe, expect, it } from "vitest";

import type { ResourceContents } from "@/data/types";
import { appPayloadFromContent, pickAppContent } from "./app-content";

describe("appPayloadFromContent", () => {
  it("treats an MCP Apps HTML resource as an html app", () => {
    const payload = appPayloadFromContent({
      uri: "ui://srv/app",
      mimeType: "text/html;profile=mcp-app",
      text: "<h1>hi</h1>",
    });
    expect(payload).toEqual({ kind: "html", html: "<h1>hi</h1>", meta: undefined });
  });

  it("falls back to html for a ui:// resource with no MIME type", () => {
    const payload = appPayloadFromContent({ uri: "ui://srv/app", text: "<b>x</b>" });
    expect(payload?.kind).toBe("html");
    expect(payload?.html).toBe("<b>x</b>");
  });

  it("parses text/uri-list, skipping comments and blanks", () => {
    const payload = appPayloadFromContent({
      uri: "ui://srv/ext",
      mimeType: "text/uri-list",
      text: "# a comment\n\nhttps://example.com/app\nhttps://second.example.com",
    });
    expect(payload).toEqual({
      kind: "url",
      url: "https://example.com/app",
      meta: undefined,
    });
  });

  it("decodes a base64 HTML blob", () => {
    const html = "<h1>blob</h1>";
    const blob = Buffer.from(html, "utf8").toString("base64");
    const payload = appPayloadFromContent({
      uri: "ui://srv/app",
      mimeType: "text/html",
      blob,
    });
    expect(payload?.kind).toBe("html");
    expect(payload?.html).toBe(html);
  });

  it("surfaces declared UI metadata from _meta.ui", () => {
    const payload = appPayloadFromContent({
      uri: "ui://srv/app",
      mimeType: "text/html;profile=mcp-app",
      text: "<h1>x</h1>",
      _meta: {
        ui: {
          csp: { connectDomains: ["https://api.example.com"] },
          prefersBorder: true,
        },
      },
    });
    expect(payload?.meta?.csp?.connectDomains).toEqual(["https://api.example.com"]);
    expect(payload?.meta?.prefersBorder).toBe(true);
  });

  it("returns null for non-UI content", () => {
    expect(
      appPayloadFromContent({
        uri: "file://data.json",
        mimeType: "application/json",
        text: "{}",
      }),
    ).toBeNull();
  });
});

describe("pickAppContent", () => {
  it("returns the first renderable UI item", () => {
    const contents: ResourceContents[] = [
      { uri: "file://x.txt", mimeType: "text/plain", text: "hi" },
      { uri: "ui://srv/app", mimeType: "text/html;profile=mcp-app", text: "<h1/>" },
    ];
    expect(pickAppContent(contents)?.uri).toBe("ui://srv/app");
  });

  it("returns undefined when nothing is renderable", () => {
    expect(
      pickAppContent([{ uri: "file://x", mimeType: "text/plain", text: "" }]),
    ).toBeUndefined();
  });
});
