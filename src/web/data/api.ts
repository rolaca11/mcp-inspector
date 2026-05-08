/**
 * Tiny client for the `mcp-inspector serve` HTTP API. Routes mirror
 * `src/server.ts`. Every action endpoint returns `{ activities: [...] }`
 * with server-computed metadata (kind, target, outcome, durationMs,
 * tokenCount). The client pushes these into the activity store so the
 * dashboard feed stays in sync.
 */

import { useActivityStore, type ActivityKind } from "@/stores/activity-store";
import type {
  ActivitiesResponse,
  ActivityResult,
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
  /** The full JSON body returned by the server (e.g. `{ error, requestBody }`). */
  responseBody?: Record<string, unknown>;
  constructor(
    status: number,
    message: string,
    responseBody?: Record<string, unknown>,
  ) {
    super(message);
    this.status = status;
    this.responseBody = responseBody;
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
  const url = `${BASE}${path}`;
  const method = init?.method ?? "GET";
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

  let r: Response;
  try {
    r = await fetch(url, opts);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(`${method} ${url}: request was aborted`);
    }
    throw new Error(`${method} ${url} failed: ${errorChain(e)}`);
  }

  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    let responseBody: Record<string, unknown> | undefined;
    try {
      const body = (await r.json()) as Record<string, unknown>;
      responseBody = body;
      if (typeof body?.error === "string") msg = body.error;
    } catch {
      /* response body was not JSON */
    }
    throw new ApiError(r.status, `${method} ${path}: ${msg}`, responseBody);
  }
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

/**
 * Calls an action endpoint that returns `{ activities: [...] }`, pushes
 * the server-computed activity entries into the client-side store, and
 * returns the activities array.
 */
async function activityCall<T>(
  serverName: string,
  path: string,
  init?: CallInit,
): Promise<ActivityResult<T>[]> {
  const resp = await call<ActivitiesResponse<T>>(path, init);
  useActivityStore.getState().insert(
    resp.activities.map((a) => ({
      kind: a.kind as ActivityKind,
      serverName,
      target: a.target,
      outcome: a.outcome,
      durationMs: a.durationMs,
      tokenCount: a.tokenCount,
      error: a.error,
      response: a.result,
    })),
  );
  return resp.activities;
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
    sourceLabel?: string;
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

  discover(
    name: string,
    signal?: AbortSignal,
  ): Promise<ActivityResult<DiscoverResult>[]> {
    return activityCall<DiscoverResult>(
      name,
      `/servers/${encodeURIComponent(name)}/discover`,
      signal ? { signal } : undefined,
    );
  },

  callTool(
    name: string,
    body:
      | { name: string; arguments?: Record<string, unknown> }
      | Array<{ name: string; arguments?: Record<string, unknown> }>,
  ): Promise<ActivityResult<ToolResult>[]> {
    return activityCall<ToolResult>(
      name,
      `/servers/${encodeURIComponent(name)}/tools/call`,
      { method: "POST", body },
    );
  },

  readResource(
    name: string,
    body: { uri: string } | Array<{ uri: string }>,
  ): Promise<ActivityResult<ReadResourceResult>[]> {
    return activityCall<ReadResourceResult>(
      name,
      `/servers/${encodeURIComponent(name)}/resources/read`,
      { method: "POST", body },
    );
  },

  getPrompt(
    name: string,
    body:
      | { name: string; arguments?: Record<string, string> }
      | Array<{ name: string; arguments?: Record<string, string> }>,
  ): Promise<ActivityResult<GetPromptResult>[]> {
    return activityCall<GetPromptResult>(
      name,
      `/servers/${encodeURIComponent(name)}/prompts/get`,
      { method: "POST", body },
    );
  },

  complete(
    name: string,
    body:
      | {
          refType: "prompt" | "resource";
          ref: string;
          argument: string;
          value?: string;
          context?: Record<string, string>;
        }
      | Array<{
          refType: "prompt" | "resource";
          ref: string;
          argument: string;
          value?: string;
          context?: Record<string, string>;
        }>,
  ): Promise<ActivityResult<CompleteResult>[]> {
    return activityCall<CompleteResult>(
      name,
      `/servers/${encodeURIComponent(name)}/complete`,
      { method: "POST", body },
    );
  },

  authStatus(name: string): Promise<AuthStatus> {
    return call(`/servers/${encodeURIComponent(name)}/auth`);
  },

  /**
   * Poll for a pending OAuth authorization URL. The server stashes it when
   * the OAuth flow fires `onRedirect` so the web UI can open it in a new
   * tab instead of the OS default browser. Returns `{ url: null }` when
   * there is nothing pending; the URL is consumed (cleared) on read.
   */
  authUrl(name: string): Promise<{ url: string | null }> {
    return call(`/servers/${encodeURIComponent(name)}/auth-url`);
  },

  authLogout(
    name: string,
  ): Promise<ActivityResult<{ removed: boolean; file: string }>[]> {
    return activityCall<{ removed: boolean; file: string }>(
      name,
      `/servers/${encodeURIComponent(name)}/auth`,
      { method: "DELETE" },
    );
  },

  disconnect(name: string): Promise<ActivityResult<{ ok: true }>[]> {
    return activityCall<{ ok: true }>(
      name,
      `/servers/${encodeURIComponent(name)}/disconnect`,
      { method: "POST" },
    );
  },

  /* Inspector config CRUD */

  configServers(): Promise<{ path: string; servers: Record<string, unknown> }> {
    return call("/config/servers");
  },

  configAddServer(
    name: string,
    config: Record<string, unknown>,
    force?: boolean,
  ): Promise<{ ok: true; name: string }> {
    return call("/config/servers", {
      method: "POST",
      body: { name, config, force },
    });
  },

  configRemoveServer(name: string): Promise<{ ok: true; name: string }> {
    return call(`/config/servers/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  },
};

export { ApiError };

/* ------------------------------------------------------------------ */
/* Tiny helpers                                                        */
/* ------------------------------------------------------------------ */

function errorChain(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  while (cur instanceof Error) {
    if (cur.message && !parts.includes(cur.message)) parts.push(cur.message);
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.join(": ") || "unknown error";
}
