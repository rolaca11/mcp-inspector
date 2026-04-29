/**
 * Tiny client for the `mcp-inspector serve` HTTP API. Routes mirror
 * `src/server.ts`. Every call is recorded to `activityLog` so the dashboard's
 * activity feed shows the real history of what was sent.
 */

import { useActivityStore, type ActivityKind } from "@/stores/activity-store";
import type {
  AuthStatus,
  CompleteResult,
  DiscoverResult,
  GetPromptResult,
  ReadResourceResult,
  ToolResult,
  Transport,
} from "./types";

const BASE = "/api";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

interface CallInit {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

async function call<T>(path: string, init?: CallInit): Promise<T> {
  const opts: RequestInit = {
    method: init?.method,
    headers: init?.headers,
    signal: init?.signal,
  };
  if (init?.body !== undefined) {
    opts.body =
      typeof init.body === "string" ? init.body : JSON.stringify(init.body);
    opts.headers = {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    };
  }
  const r = await fetch(`${BASE}${path}`, opts);
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const body = (await r.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(r.status, msg);
  }
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

/**
 * Wraps a call so it appears in the activity log. The `detail` callback
 * receives the parsed result and returns a one-line summary for the feed.
 */
async function tracked<T>(
  serverName: string,
  kind: ActivityKind,
  target: string,
  payload: string | undefined,
  fn: () => Promise<T>,
  summarize?: (result: T) => string,
): Promise<T> {
  const tx = useActivityStore.getState().start({
    kind,
    serverName,
    target,
    ...(payload != null ? { detail: payload } : {}),
  });
  try {
    const result = await fn();
    // Extract _tokenCount from the response if available.
    const tokenCount =
      result != null && typeof result === "object" && "_tokenCount" in result
        ? (result as { _tokenCount?: number | null })._tokenCount
        : undefined;
    tx.finish(summarize ? summarize(result) : payload, tokenCount);
    return result;
  } catch (e) {
    tx.fail((e as Error).message);
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

export interface ServersListResponse {
  sources: Array<{ path: string; serverCount: number }>;
  errors: Array<{ path: string; message: string }>;
  servers: Array<{
    name: string;
    source: string;
    transport: Transport;
    target: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    headers?: Record<string, string>;
  }>;
}

export const api = {
  health(): Promise<{ ok: true }> {
    return call("/health");
  },

  servers(): Promise<ServersListResponse> {
    return call("/servers");
  },

  discover(name: string, signal?: AbortSignal): Promise<DiscoverResult> {
    return tracked(
      name,
      "discover",
      "discover",
      undefined,
      () =>
        call<DiscoverResult>(
          `/servers/${encodeURIComponent(name)}/discover`,
          signal ? { signal } : undefined,
        ),
      (r) => {
        const counts = [
          r.tools.length && `${r.tools.length} tools`,
          r.resources.length && `${r.resources.length} resources`,
          r.resourceTemplates.length &&
            `${r.resourceTemplates.length} templates`,
          r.prompts.length && `${r.prompts.length} prompts`,
        ].filter(Boolean);
        return counts.join(" · ");
      },
    );
  },

  callTool(
    name: string,
    body: { name: string; arguments?: Record<string, unknown> },
  ): Promise<ToolResult> {
    return tracked(
      name,
      "tool-call",
      body.name,
      truncate(JSON.stringify(body.arguments ?? {})),
      () =>
        call<ToolResult>(`/servers/${encodeURIComponent(name)}/tools/call`, {
          method: "POST",
          body,
        }),
      (r) => (r.isError ? "isError: true" : firstTextPreview(r)),
    );
  },

  readResource(
    name: string,
    body: { uri: string },
  ): Promise<ReadResourceResult> {
    return tracked(
      name,
      "resource-read",
      body.uri,
      undefined,
      () =>
        call<ReadResourceResult>(
          `/servers/${encodeURIComponent(name)}/resources/read`,
          { method: "POST", body },
        ),
      (r) => {
        const c = r.contents[0];
        if (!c) return "no contents";
        const len = c.text?.length ?? c.blob?.length ?? 0;
        return `${c.mimeType ?? "?"} · ${formatBytes(len)}`;
      },
    );
  },

  getPrompt(
    name: string,
    body: { name: string; arguments?: Record<string, string> },
  ): Promise<GetPromptResult> {
    return tracked(
      name,
      "prompt-get",
      body.name,
      truncate(JSON.stringify(body.arguments ?? {})),
      () =>
        call<GetPromptResult>(
          `/servers/${encodeURIComponent(name)}/prompts/get`,
          { method: "POST", body },
        ),
      (r) => `${r.messages.length} message${r.messages.length === 1 ? "" : "s"}`,
    );
  },

  complete(
    name: string,
    body: {
      refType: "prompt" | "resource";
      ref: string;
      argument: string;
      value?: string;
      context?: Record<string, string>;
    },
  ): Promise<CompleteResult> {
    return tracked(
      name,
      "complete",
      `${body.refType}:${body.ref}/${body.argument}`,
      body.value || undefined,
      () =>
        call<CompleteResult>(`/servers/${encodeURIComponent(name)}/complete`, {
          method: "POST",
          body,
        }),
      (r) =>
        `${r.completion.values.length} result${r.completion.values.length === 1 ? "" : "s"}` +
        (r.completion.total ? ` of ${r.completion.total}` : ""),
    );
  },

  authStatus(name: string): Promise<AuthStatus> {
    return call(`/servers/${encodeURIComponent(name)}/auth`);
  },

  authLogout(name: string): Promise<{ removed: boolean; file: string }> {
    return tracked(
      name,
      "auth",
      "logout",
      undefined,
      () =>
        call(`/servers/${encodeURIComponent(name)}/auth`, {
          method: "DELETE",
        }),
      (r) => (r.removed ? "removed token store" : "no token store"),
    );
  },

  disconnect(name: string): Promise<{ ok: true }> {
    return tracked(
      name,
      "disconnect",
      name,
      undefined,
      () =>
        call(`/servers/${encodeURIComponent(name)}/disconnect`, {
          method: "POST",
        }),
      () => "session closed",
    );
  },
};

export { ApiError };

/* ------------------------------------------------------------------ */
/* Tiny helpers                                                        */
/* ------------------------------------------------------------------ */

function truncate(s: string, n = 120): string {
  if (!s) return s;
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function firstTextPreview(r: ToolResult): string {
  for (const c of r.content) {
    if (c.type === "text") return truncate(c.text.replace(/\s+/g, " ").trim(), 80);
    if (c.type === "image") return `image · ${c.mimeType}`;
    if (c.type === "audio") return `audio · ${c.mimeType}`;
    if (c.type === "resource_link") return `link · ${c.uri}`;
    if (c.type === "resource") return `embedded · ${c.resource.uri}`;
  }
  return "ok";
}

function formatBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
