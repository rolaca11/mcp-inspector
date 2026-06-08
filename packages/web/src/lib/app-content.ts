/**
 * Adapt MCP resource contents into the shape the `McpAppFrame` renderer wants.
 * Shared by the Tools page (linked + embedded apps) and the Resources page
 * (app preview).
 */

import type { ResourceContents } from "@/data/types";
import {
  resourceUiMeta,
  uiRenderKind,
  type UiRenderKind,
  type UiResourceMeta,
} from "@/lib/mcp-apps";

export interface AppPayload {
  kind: UiRenderKind;
  html?: string;
  url?: string;
  meta?: UiResourceMeta;
}

/** Decode a base64 `blob` to text, tolerating UTF-8. */
function decodeBlob(b64: string): string | undefined {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

/** First real URL in an RFC 2483 `text/uri-list` body (skips `#` comments). */
function firstUriListEntry(text: string | undefined): string | undefined {
  if (!text) return undefined;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) return trimmed;
  }
  return undefined;
}

/** Build an app payload from one resource-contents item, or null if not a UI. */
export function appPayloadFromContent(
  content: ResourceContents,
): AppPayload | null {
  const kind = uiRenderKind(content.mimeType, content.uri);
  if (!kind) return null;

  const meta = resourceUiMeta(content._meta);

  if (kind === "url") {
    const url = firstUriListEntry(content.text);
    return url ? { kind, url, meta } : null;
  }

  const html =
    content.text ?? (content.blob ? decodeBlob(content.blob) : undefined);
  return { kind, html, meta };
}

/** Pick the first renderable UI item out of a `resources/read` result. */
export function pickAppContent(
  contents: ResourceContents[],
): ResourceContents | undefined {
  return contents.find((c) => uiRenderKind(c.mimeType, c.uri) !== null);
}
