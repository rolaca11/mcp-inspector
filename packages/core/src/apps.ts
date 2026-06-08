/**
 * MCP Apps (SEP-1865) — interactive user interfaces for MCP.
 *
 * A server can ship an HTML "app" as a `ui://` resource and link a tool to it
 * via `_meta`. A client that advertises the `io.modelcontextprotocol/ui`
 * extension renders that resource in a sandboxed iframe and feeds it the
 * tool's input/output over a postMessage bridge.
 *
 * This module is the single source of truth for the wire-level constants and
 * the `_meta` shapes — the helpers are deliberately pure (no Node imports) so
 * the web bundle can import them too via the `./apps` export.
 *
 * It also recognizes the two predecessor conventions the spec unifies, so the
 * inspector can render apps from servers that haven't migrated yet:
 *   - the community **mcp-ui** project (`text/html`, `text/uri-list`,
 *     `application/vnd.mcp-ui.remote-dom…`, embedded in the tool result), and
 *   - the **OpenAI Apps SDK** (`text/html+skybridge`, `openai/*` meta keys).
 */

/* ------------------------------------------------------------------ */
/* Wire constants                                                      */
/* ------------------------------------------------------------------ */

/** Extension identifier negotiated under `capabilities.extensions`. */
export const UI_EXTENSION_ID = "io.modelcontextprotocol/ui";

/** MIME type of an MCP Apps UI resource (a full HTML document). */
export const UI_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

/** URI scheme every UI resource uses. */
export const UI_URI_SCHEME = "ui://";

/**
 * Capability object the inspector (acting as host) adds to its `initialize`
 * request. Servers that gate UI-enabled tools on this won't emit them unless
 * the host advertises a compatible MIME type.
 */
export function uiClientExtensions(): Record<string, { mimeTypes: string[] }> {
  return { [UI_EXTENSION_ID]: { mimeTypes: [UI_RESOURCE_MIME_TYPE] } };
}

/* ------------------------------------------------------------------ */
/* `_meta` shapes                                                      */
/* ------------------------------------------------------------------ */

/** Content-Security-Policy hints declared on a UI resource. */
export interface UiCsp {
  /** Origins the app may `connect-src` to (fetch / XHR / WebSocket). */
  connectDomains?: string[];
  /** Origins for `img/script/style/font/media-src`. */
  resourceDomains?: string[];
  /** Origins allowed in nested `frame-src`. */
  frameDomains?: string[];
  /** Origins allowed in `base-uri`. */
  baseUriDomains?: string[];
}

/** Normalized `_meta.ui` of a UI resource (with OpenAI aliases folded in). */
export interface UiResourceMeta {
  csp?: UiCsp;
  /** Presence flags requesting iframe `allow=` permissions. */
  permissions?: {
    camera?: boolean;
    microphone?: boolean;
    geolocation?: boolean;
    clipboardWrite?: boolean;
  };
  /** Dedicated sandbox origin requested by the server (host-specific). */
  domain?: string;
  /** Hint that the host should draw a border around the app. */
  prefersBorder?: boolean;
}

type Meta = Record<string, unknown> | undefined | null;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string");
  return out.length > 0 ? out : undefined;
}

/* ------------------------------------------------------------------ */
/* Tool → UI template link                                             */
/* ------------------------------------------------------------------ */

/**
 * Resolve the `ui://` resource a tool renders into, checking — in priority
 * order — the canonical nested key, the deprecated flat key, and the OpenAI
 * Apps SDK key.
 *
 *   `_meta.ui.resourceUri`        ← canonical (SEP-1865)
 *   `_meta["ui/resourceUri"]`     ← deprecated, removed before GA
 *   `_meta["openai/outputTemplate"]` ← OpenAI Apps SDK
 */
export function toolUiResourceUri(meta: Meta): string | undefined {
  if (!meta) return undefined;
  const ui = asRecord(meta.ui);
  return (
    (ui && asString(ui.resourceUri)) ??
    asString(meta["ui/resourceUri"]) ??
    asString(meta["openai/outputTemplate"])
  );
}

/** Whether a tool declares an app UI at all. */
export function toolHasUi(meta: Meta): boolean {
  return toolUiResourceUri(meta) !== undefined;
}

/**
 * Visibility of a tool per the spec: `"model"` (offered to the agent) and/or
 * `"app"` (callable by the rendered app). Defaults to both when unspecified.
 */
export function toolVisibility(meta: Meta): Array<"model" | "app"> {
  const ui = asRecord(meta?.ui);
  const raw = asStringArray(ui?.visibility);
  const filtered = raw?.filter(
    (v): v is "model" | "app" => v === "model" || v === "app",
  );
  return filtered && filtered.length > 0 ? filtered : ["model", "app"];
}

/* ------------------------------------------------------------------ */
/* Resource UI metadata                                                */
/* ------------------------------------------------------------------ */

function normalizeCsp(raw: Record<string, unknown> | undefined): UiCsp | undefined {
  if (!raw) return undefined;
  // Accept both the spec's camelCase keys and OpenAI's snake_case aliases.
  const csp: UiCsp = {};
  csp.connectDomains =
    asStringArray(raw.connectDomains) ?? asStringArray(raw.connect_domains);
  csp.resourceDomains =
    asStringArray(raw.resourceDomains) ?? asStringArray(raw.resource_domains);
  csp.frameDomains =
    asStringArray(raw.frameDomains) ?? asStringArray(raw.frame_domains);
  csp.baseUriDomains =
    asStringArray(raw.baseUriDomains) ?? asStringArray(raw.base_uri_domains);
  return Object.values(csp).some((v) => v !== undefined) ? csp : undefined;
}

function normalizePermissions(
  raw: Record<string, unknown> | undefined,
): UiResourceMeta["permissions"] | undefined {
  if (!raw) return undefined;
  // The spec uses presence (an empty object) to grant a permission.
  const has = (k: string) => k in raw && raw[k] !== false && raw[k] != null;
  const perms = {
    camera: has("camera"),
    microphone: has("microphone"),
    geolocation: has("geolocation"),
    clipboardWrite: has("clipboardWrite"),
  };
  return Object.values(perms).some(Boolean) ? perms : undefined;
}

/**
 * Read and normalize the UI metadata declared on a resource (either the
 * `resources/list` entry or a `resources/read` content item). Folds the
 * OpenAI `openai/widget*` aliases into the canonical `_meta.ui` shape.
 */
export function resourceUiMeta(meta: Meta): UiResourceMeta | undefined {
  if (!meta) return undefined;
  const ui = asRecord(meta.ui);

  const csp =
    normalizeCsp(asRecord(ui?.csp)) ??
    normalizeCsp(asRecord(meta["openai/widgetCSP"]));
  const permissions = normalizePermissions(asRecord(ui?.permissions));
  const domain =
    (ui && asString(ui.domain)) ?? asString(meta["openai/widgetDomain"]);
  const prefersBorder =
    typeof ui?.prefersBorder === "boolean"
      ? (ui.prefersBorder as boolean)
      : typeof meta["openai/widgetPrefersBorder"] === "boolean"
        ? (meta["openai/widgetPrefersBorder"] as boolean)
        : undefined;

  if (!csp && !permissions && domain === undefined && prefersBorder === undefined) {
    return undefined;
  }
  return { csp, permissions, domain, prefersBorder };
}

/* ------------------------------------------------------------------ */
/* Render-kind detection                                               */
/* ------------------------------------------------------------------ */

/**
 * How a UI payload should be rendered:
 *   - `"html"`       — inline an HTML document into a sandboxed iframe
 *                      (`text/html`, `text/html;profile=mcp-app`,
 *                      `text/html+skybridge`).
 *   - `"url"`        — point an iframe at an external URL (`text/uri-list`).
 *   - `"remote-dom"` — mcp-ui Remote DOM script (not natively renderable here).
 */
export type UiRenderKind = "html" | "url" | "remote-dom";

export function uiRenderKind(
  mimeType: string | undefined,
  uri?: string,
): UiRenderKind | null {
  const m = mimeType?.toLowerCase().trim();
  if (m) {
    if (m.startsWith("text/html")) return "html";
    if (m.startsWith("text/uri-list")) return "url";
    if (m.startsWith("application/vnd.mcp-ui.remote-dom")) return "remote-dom";
    return null;
  }
  // No MIME type but a `ui://` URI: assume an HTML app.
  return isUiResourceUri(uri) ? "html" : null;
}

/** Whether a URI uses the `ui://` scheme reserved for UI resources. */
export function isUiResourceUri(uri: string | undefined): boolean {
  return typeof uri === "string" && uri.startsWith(UI_URI_SCHEME);
}

/**
 * Whether a resource (by MIME type and/or URI) is a renderable UI app. Used to
 * decide whether to offer an app preview alongside the raw contents.
 */
export function isRenderableUiResource(
  mimeType: string | undefined,
  uri?: string,
): boolean {
  const kind = uiRenderKind(mimeType, uri);
  return kind === "html" || kind === "url";
}
