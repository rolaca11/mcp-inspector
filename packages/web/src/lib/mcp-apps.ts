/**
 * Browser-side plumbing for rendering MCP Apps (SEP-1865) in the inspector.
 *
 * The host bridge itself is the official `@modelcontextprotocol/ext-apps`
 * `AppBridge` (see `components/mcp-app-frame.tsx`). The shared `_meta`/MIME
 * detection lives in the core `apps` module (so the CLI and dashboard agree);
 * this file adds what only the renderer needs around the bridge: the iframe
 * sandbox/CSP construction, the sandbox-proxy origin, and the host-context
 * payload.
 */

import {
  type UiCsp,
  type UiResourceMeta,
} from "@rolaca11/mcp-inspector-core/apps";

export {
  UI_EXTENSION_ID,
  UI_RESOURCE_MIME_TYPE,
  UI_URI_SCHEME,
  toolUiResourceUri,
  toolHasUi,
  toolVisibility,
  resourceUiMeta,
  uiRenderKind,
  isUiResourceUri,
  isRenderableUiResource,
} from "@rolaca11/mcp-inspector-core/apps";
export type { UiCsp, UiResourceMeta, UiRenderKind } from "@rolaca11/mcp-inspector-core/apps";

/* ------------------------------------------------------------------ */
/* Host context delivered to the app on initialize                     */
/* ------------------------------------------------------------------ */

export type DisplayMode = "inline" | "fullscreen" | "pip";

export interface HostContext {
  theme?: "light" | "dark";
  displayMode?: DisplayMode;
  locale?: string;
  userAgent?: string;
  platform?: "web" | "desktop" | "mobile";
}

/** Build the `hostContext` reported to an app during `ui/initialize`. */
export function buildHostContext(displayMode: DisplayMode = "inline"): HostContext {
  const dark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");
  return {
    theme: dark ? "dark" : "light",
    displayMode,
    locale:
      typeof navigator !== "undefined" ? navigator.language : undefined,
    userAgent:
      typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    platform: "web",
  };
}

/* ------------------------------------------------------------------ */
/* Iframe sandbox + Content-Security-Policy                            */
/* ------------------------------------------------------------------ */

/**
 * Sandbox tokens for the app iframe.
 *
 * `allow-same-origin` is granted ONLY when the frame's content lives on an
 * origin distinct from the dashboard — i.e. an external URL, or the inner frame
 * of the sandbox proxy served from a sibling origin. There it lets the app use
 * storage/workers while staying cross-origin to the dashboard. For an inline
 * `srcdoc` document on the dashboard's own origin we omit it, so the frame runs
 * in an opaque origin and cannot reach the dashboard's DOM, storage, or API.
 */
export const APP_SANDBOX_TOKENS = [
  "allow-scripts",
  "allow-forms",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-modals",
] as const;

export function sandboxAttr(opts?: { sameOrigin?: boolean }): string {
  const tokens = opts?.sameOrigin
    ? ["allow-same-origin", ...APP_SANDBOX_TOKENS]
    : [...APP_SANDBOX_TOKENS];
  return tokens.join(" ");
}

/**
 * Path the static sandbox-proxy page is served from (Vite `public/`). It must be
 * served from our own origin so the swapped sibling origin below resolves to a
 * page we control; a third-party URL (e.g. raw.githubusercontent.com) can't be
 * used — it's served as `text/plain` and wouldn't execute as an iframe. The
 * page itself mirrors the official inspector's `sandbox_proxy.html`.
 */
export const SANDBOX_PAGE_PATH = "/mcp-app-sandbox.html";

/**
 * URL of the sandbox-proxy page on a sibling origin, or `null` when no distinct
 * sibling origin is reachable (then the host falls back to an opaque-origin
 * `srcdoc`). We swap `127.0.0.1`↔`localhost` (same server, distinct origins) for
 * the web app, and the `inspector`→`mcp-app-sandbox` host for the Electron
 * `app:` scheme.
 */
export function sandboxPageUrl(): string | null {
  if (typeof window === "undefined") return null;
  const loc = window.location;
  let altHost: string | null = null;
  if (loc.hostname === "127.0.0.1") altHost = "localhost";
  else if (loc.hostname === "localhost") altHost = "127.0.0.1";
  else if (loc.protocol === "app:" && loc.hostname === "inspector")
    altHost = "mcp-app-sandbox";
  if (!altHost) return null;
  const port = loc.port ? `:${loc.port}` : "";
  return `${loc.protocol}//${altHost}${port}${SANDBOX_PAGE_PATH}`;
}

/** Map declared permissions to an iframe `allow` attribute value. */
export function allowAttr(meta?: UiResourceMeta): string | undefined {
  const p = meta?.permissions;
  if (!p) return undefined;
  const out: string[] = [];
  if (p.camera) out.push("camera");
  if (p.microphone) out.push("microphone");
  if (p.geolocation) out.push("geolocation");
  if (p.clipboardWrite) out.push("clipboard-write");
  return out.length > 0 ? out.join("; ") : undefined;
}

/**
 * Convert our boolean permission flags to the spec's presence-object shape
 * (`{ camera: {} }`) used by `ui/notifications/sandbox-resource-ready`.
 */
export function toResourcePermissions(
  permissions: UiResourceMeta["permissions"] | undefined,
): Record<string, Record<string, never>> | undefined {
  if (!permissions) return undefined;
  const out: Record<string, Record<string, never>> = {};
  if (permissions.camera) out.camera = {};
  if (permissions.microphone) out.microphone = {};
  if (permissions.geolocation) out.geolocation = {};
  if (permissions.clipboardWrite) out.clipboardWrite = {};
  return Object.keys(out).length > 0 ? out : undefined;
}

function hasDeclaredCsp(csp?: UiCsp): boolean {
  return (
    !!csp &&
    [
      csp.connectDomains,
      csp.resourceDomains,
      csp.frameDomains,
      csp.baseUriDomains,
    ].some((d) => d && d.length > 0)
  );
}

/**
 * Build the `Content-Security-Policy` for the sandboxed document.
 *
 * When the resource declares `_meta.ui.csp`, we honor it strictly — the spec's
 * restrictive base widened only by the declared domains — so a developer can
 * verify the exact policy production hosts would enforce.
 *
 * When nothing is declared, we fall back to a permissive policy. The inspector
 * is a developer tool whose job is to actually render the app, and the real
 * security boundary is the opaque-origin sandbox (no `allow-same-origin`, so no
 * access to the dashboard's DOM, storage, or API) — not this CSP. A strict
 * default would leave most real apps (CDN assets, tile servers, API calls)
 * blank.
 */
export function cspToString(csp?: UiCsp): string {
  if (!hasDeclaredCsp(csp)) {
    return [
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https: data: blob:",
      "connect-src https: wss: data: blob:",
      "img-src https: data: blob: 'self'",
      "worker-src 'self' blob:",
      "frame-src https:",
    ].join("; ");
  }

  const resource = csp?.resourceDomains ?? [];
  // A declared CSP constrains *origins* (where data may flow). Real apps still
  // need the in-frame execution primitives most frameworks rely on — eval/Function
  // (e.g. CesiumJS, knockout), WebAssembly, and blob-backed workers — which the
  // sandbox's opaque origin already contains. We grant those unconditionally and
  // restrict only the domains, to the ones the server declared.
  const directives: Record<string, string[]> = {
    "default-src": ["'none'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      "'unsafe-eval'",
      "'wasm-unsafe-eval'",
      ...resource,
    ],
    "worker-src": ["'self'", "blob:", ...resource],
    "style-src": ["'self'", "'unsafe-inline'", ...resource],
    "img-src": ["'self'", "data:", "blob:", ...resource],
    "font-src": ["'self'", "data:", ...resource],
    "media-src": ["'self'", "data:", "blob:", ...resource],
    "connect-src":
      csp?.connectDomains && csp.connectDomains.length > 0
        ? [...csp.connectDomains, "data:", "blob:"]
        : ["'none'"],
    "frame-src":
      csp?.frameDomains && csp.frameDomains.length > 0
        ? csp.frameDomains
        : ["'none'"],
    "object-src": ["'none'"],
    "base-uri":
      csp?.baseUriDomains && csp.baseUriDomains.length > 0
        ? csp.baseUriDomains
        : ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

const CSP_META_RE = /<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/i;

/**
 * Return an HTML document ready for `srcdoc`, with a host-controlled CSP
 * `<meta>` injected. Any CSP the server's own document declared is stripped so
 * the host policy is authoritative.
 */
export function buildSrcDoc(html: string, csp?: UiCsp): string {
  const policy = cspToString(csp);
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  const withoutServerCsp = html.replace(CSP_META_RE, "");

  // Insert right after <head ...> when present so the policy applies before any
  // resource loads; otherwise synthesize a head, or wrap a bare fragment.
  if (/<head[^>]*>/i.test(withoutServerCsp)) {
    return withoutServerCsp.replace(/(<head[^>]*>)/i, `$1${metaTag}`);
  }
  if (/<html[^>]*>/i.test(withoutServerCsp)) {
    return withoutServerCsp.replace(
      /(<html[^>]*>)/i,
      `$1<head>${metaTag}</head>`,
    );
  }
  return `<!doctype html><html><head>${metaTag}</head><body>${withoutServerCsp}</body></html>`;
}
