import * as React from "react";
import {
  ArrowUpRight,
  ChevronDown,
  Maximize2,
  Minimize2,
  RefreshCw,
  SquareArrowOutUpRight,
} from "lucide-react";
import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";

import { api } from "@/data/api";
import type { ToolResult } from "@/data/types";
import { cn } from "@/lib/utils";
import {
  allowAttr,
  buildHostContext,
  buildSrcDoc,
  sandboxAttr,
  sandboxPageUrl,
  toResourcePermissions,
  type UiRenderKind,
  type UiResourceMeta,
} from "@/lib/mcp-apps";

type EventTone = "in" | "out" | "call" | "warn";
interface BridgeEvent {
  id: number;
  label: string;
  detail?: string;
  tone: EventTone;
}

export interface McpAppFrameProps {
  /** Server the app belongs to — follow-up calls route through it. */
  serverName: string;
  /** How the payload should be rendered. */
  kind: UiRenderKind;
  /** Inline HTML document (for `kind === "html"`). */
  html?: string;
  /** External URL (for `kind === "url"`). */
  url?: string;
  /** Resource UI metadata (CSP, permissions, border). */
  meta?: UiResourceMeta;
  /** Tool arguments that produced this view. */
  toolInput?: Record<string, unknown>;
  /** Tool result delivered to the app. */
  toolResult?: ToolResult;
  /** Label shown in the frame header. */
  title?: string;
}

const DEFAULT_HEIGHT = 420;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 4000;
const MAX_EVENTS = 100;

const HOST_INFO = { name: "mcp-inspector", version: __PKG_VERSION__ };
const HOST_CAPABILITIES = {
  openLinks: {},
  serverTools: {},
  serverResources: {},
  logging: {},
};

/**
 * Renders an MCP App (SEP-1865) in a sandboxed iframe, bridged to the host with
 * the official `@modelcontextprotocol/ext-apps` `AppBridge`. Tool calls and
 * resource reads the app initiates are proxied to the server through the tRPC
 * API (so they also appear in the activity log).
 *
 * `html` apps render through the spec's sandbox proxy on a sibling origin (so
 * the app can be granted `allow-same-origin` — storage, workers — while staying
 * cross-origin to the dashboard), falling back to an opaque-origin `srcdoc`
 * when no sibling origin is reachable. `url` apps load directly (already
 * cross-origin).
 */
export function McpAppFrame({
  serverName,
  kind,
  html,
  url,
  meta,
  toolInput,
  toolResult,
  title,
}: McpAppFrameProps) {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const bridgeRef = React.useRef<AppBridge | null>(null);
  const initializedRef = React.useRef(false);
  const inputSentRef = React.useRef(false);
  const toolInputRef = React.useRef(toolInput);
  const toolResultRef = React.useRef(toolResult);
  const expandedRef = React.useRef(false);
  const eventIdRef = React.useRef(0);
  const proxyReadyRef = React.useRef(false);

  // For `html` apps, prefer the spec's sandbox proxy on a sibling origin.
  const proxyUrl = React.useMemo(
    () => (kind === "html" ? sandboxPageUrl() : null),
    [kind],
  );

  const srcDoc = React.useMemo(
    () => (kind === "html" && html != null ? buildSrcDoc(html, meta?.csp) : undefined),
    [kind, html, meta?.csp],
  );
  const srcDocRef = React.useRef(srcDoc);

  const [height, setHeight] = React.useState(DEFAULT_HEIGHT);
  const [expanded, setExpanded] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [events, setEvents] = React.useState<BridgeEvent[]>([]);
  const [showLog, setShowLog] = React.useState(false);
  const [mode, setMode] = React.useState<"proxy" | "direct">(
    proxyUrl ? "proxy" : "direct",
  );

  React.useEffect(() => {
    toolInputRef.current = toolInput;
    toolResultRef.current = toolResult;
  }, [toolInput, toolResult]);
  React.useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);
  React.useEffect(() => {
    srcDocRef.current = srcDoc;
  }, [srcDoc]);

  const log = React.useCallback(
    (tone: EventTone, label: string, detail?: string) => {
      setEvents((prev) => {
        const next = [...prev, { id: eventIdRef.current++, tone, label, detail }];
        return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
      });
    },
    [],
  );

  // If the sandbox proxy never reports ready (sibling origin unreachable), fall
  // back to rendering the app inline in an opaque-origin srcdoc.
  React.useEffect(() => {
    if (mode !== "proxy") return;
    const timer = setTimeout(() => {
      if (!proxyReadyRef.current) {
        log("warn", "sandbox proxy unreachable — using inline fallback");
        setMode("direct");
      }
    }, 6000);
    return () => clearTimeout(timer);
    // reloadKey re-arms the timer on reload.
  }, [mode, reloadKey, log]);

  /** Push tool input (once) then result to the live view. */
  const deliverToolData = React.useCallback(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !initializedRef.current) return;
    if (!inputSentRef.current) {
      inputSentRef.current = true;
      void bridge.sendToolInput({ arguments: toolInputRef.current ?? {} });
    }
    if (toolResultRef.current) {
      void bridge.sendToolResult(toolResultRef.current as never);
    }
  }, []);

  // Re-deliver when the tool result changes after the app is already live.
  React.useEffect(() => {
    if (initializedRef.current) deliverToolData();
  }, [toolInput, toolResult, deliverToolData]);

  /* -------------------------------------------------------------- */
  /* Host bridge (ext-apps AppBridge)                                */
  /* -------------------------------------------------------------- */

  React.useEffect(() => {
    const iframe = iframeRef.current;
    const target = iframe?.contentWindow;
    if (!iframe || !target) return;
    if (kind === "remote-dom") return;

    const bridge = new AppBridge(null, HOST_INFO, HOST_CAPABILITIES, {
      hostContext: buildHostContext(
        expandedRef.current ? "fullscreen" : "inline",
      ) as never,
    });
    bridgeRef.current = bridge;
    initializedRef.current = false;
    inputSentRef.current = false;

    bridge.oncalltool = async (params) => {
      log("call", `tools/call → ${params.name}`, JSON.stringify(params.arguments ?? {}));
      const acts = await api.callTool(serverName, {
        name: params.name,
        arguments: (params.arguments as Record<string, unknown>) ?? {},
      });
      const act = acts[0];
      if (!act || act.outcome === "error") {
        throw new Error(act?.error ?? "tool call failed");
      }
      return act.result as never;
    };

    bridge.onreadresource = async (params) => {
      log("call", `resources/read → ${params.uri}`);
      const acts = await api.readResource(serverName, { uri: params.uri });
      const act = acts[0];
      if (!act || act.outcome === "error") {
        throw new Error(act?.error ?? "resource read failed");
      }
      return act.result as never;
    };

    bridge.onopenlink = async ({ url: rawUrl }) => {
      let parsed: URL | null = null;
      try {
        parsed = new URL(rawUrl, window.location.href);
      } catch {
        /* ignore */
      }
      if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
        log("warn", "ui/open-link refused", rawUrl);
        return { isError: true };
      }
      log("out", "ui/open-link", parsed.toString());
      window.open(parsed.toString(), "_blank", "noopener,noreferrer");
      return {};
    };

    bridge.onmessage = async ({ content }) => {
      const text = Array.isArray(content)
        ? content
            .map((c) => (c && typeof c === "object" && "text" in c ? (c as { text?: string }).text : ""))
            .filter(Boolean)
            .join(" ")
        : "";
      log("out", "ui/message", text);
      return {};
    };

    bridge.onrequestdisplaymode = async ({ mode: requested }) => {
      const next = requested === "fullscreen" ? "fullscreen" : "inline";
      setExpanded(next === "fullscreen");
      log("out", "ui/request-display-mode", next);
      return { mode: next };
    };

    bridge.onupdatemodelcontext = async () => {
      log("out", "ui/update-model-context");
      return {};
    };

    bridge.onloggingmessage = ({ level, data }) => {
      log(level === "error" ? "warn" : "out", `log:${level}`, stringifyLog(data));
    };

    bridge.addEventListener("sizechange", ({ height: h }) => {
      if (typeof h === "number") setHeight(clampHeight(h));
    });

    bridge.addEventListener("sandboxready", () => {
      proxyReadyRef.current = true;
      log("in", "sandbox-proxy-ready");
      void bridge.sendSandboxResourceReady({
        html: srcDocRef.current ?? "",
        sandbox: sandboxAttr({ sameOrigin: true }),
        ...(meta?.permissions
          ? { permissions: toResourcePermissions(meta.permissions) }
          : {}),
      } as never);
    });

    bridge.addEventListener("initialized", () => {
      initializedRef.current = true;
      log("in", "initialized");
      deliverToolData();
    });

    const transport = new PostMessageTransport(target, target);
    void bridge.connect(transport).catch((e) => {
      log("warn", "bridge connect failed", (e as Error).message);
    });

    return () => {
      bridgeRef.current = null;
      void bridge.close().catch(() => {});
    };
  }, [serverName, kind, mode, reloadKey, log, deliverToolData, meta]);

  /* -------------------------------------------------------------- */
  /* Controls                                                        */
  /* -------------------------------------------------------------- */

  const onReload = React.useCallback(() => {
    proxyReadyRef.current = false;
    setEvents([]);
    setMode(proxyUrl ? "proxy" : "direct");
    setReloadKey((k) => k + 1);
  }, [proxyUrl]);

  if (kind === "remote-dom") {
    return (
      <Notice>
        This app uses mcp-ui Remote DOM (<code>{"application/vnd.mcp-ui.remote-dom"}</code>),
        which renders through the host's own component library and isn't
        supported by the inspector's iframe renderer.
      </Notice>
    );
  }
  if (kind === "html" && html == null) {
    return <Notice>No HTML content to render for this app.</Notice>;
  }
  if (kind === "url" && !url) {
    return <Notice>No URL to load for this app.</Notice>;
  }

  const frameHeight = expanded ? "80vh" : `${height}px`;

  // Choose how the frame is sourced:
  //  - proxy: load the sandbox page (sibling origin) → app gets allow-same-origin
  //  - url:   load the external URL directly (already cross-origin)
  //  - direct: inline the document via opaque-origin srcdoc (no same-origin)
  const useProxy = kind === "html" && mode === "proxy" && proxyUrl != null;
  const frameSrc = useProxy ? proxyUrl : kind === "url" ? url : undefined;
  const frameSrcDoc = !useProxy && kind === "html" ? srcDoc : undefined;
  const crossOrigin = useProxy || kind === "url";
  const frameSandbox = sandboxAttr({ sameOrigin: crossOrigin });
  // In proxy mode the inner frame (not this one) carries the `allow` permissions.
  const frameAllow = useProxy ? undefined : allowAttr(meta);

  return (
    <div
      className={cn(
        "rounded-md border bg-card/30 overflow-hidden",
        meta?.prefersBorder ? "border-border" : "border-border/60",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/60 bg-black/20 px-3 py-1.5">
        <SquareArrowOutUpRight className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-mono text-muted-foreground truncate">
          {title ?? "App"}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {kind === "url" && url && (
            <FrameButton
              label="Open in new tab"
              onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
            >
              <ArrowUpRight className="size-3.5" />
            </FrameButton>
          )}
          <FrameButton
            label={expanded ? "Collapse" : "Expand"}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </FrameButton>
          <FrameButton label="Reload app" onClick={onReload}>
            <RefreshCw className="size-3.5" />
          </FrameButton>
        </span>
      </div>

      <iframe
        key={`${mode}-${reloadKey}`}
        ref={iframeRef}
        title={title ?? "MCP App"}
        sandbox={frameSandbox}
        allow={frameAllow}
        srcDoc={frameSrcDoc}
        src={frameSrc}
        className="w-full bg-white block"
        style={{ height: frameHeight }}
      />

      {events.length > 0 && (
        <div className="border-t border-border/60">
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <ChevronDown
              className={cn("size-3.5 transition-transform", showLog && "rotate-180")}
            />
            App ↔ host messages
            <span className="ml-1 rounded bg-muted/50 px-1.5 font-mono tabular-nums">
              {events.length}
            </span>
          </button>
          {showLog && (
            <div className="max-h-48 overflow-y-auto border-t border-border/40 px-3 py-2 space-y-1 font-mono text-[11px]">
              {events.map((e) => (
                <div key={e.id} className="flex items-start gap-2">
                  <span className={cn("shrink-0", eventToneClass(e.tone))}>
                    {eventToneGlyph(e.tone)}
                  </span>
                  <span className="text-foreground/90">{e.label}</span>
                  {e.detail && (
                    <span className="text-muted-foreground/70 truncate">
                      {e.detail}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

function FrameButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors cursor-pointer"
    >
      {children}
    </button>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-card/20 px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function clampHeight(h: number): number {
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(h)));
}

function stringifyLog(data: unknown): string {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function eventToneClass(tone: EventTone): string {
  switch (tone) {
    case "in":
      return "text-info";
    case "out":
      return "text-success";
    case "call":
      return "text-warning";
    case "warn":
      return "text-destructive";
  }
}

function eventToneGlyph(tone: EventTone): string {
  switch (tone) {
    case "in":
      return "←";
    case "out":
      return "→";
    case "call":
      return "⇄";
    case "warn":
      return "!";
  }
}
