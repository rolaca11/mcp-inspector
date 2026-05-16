import { TRPCClientError } from "@trpc/client";

import { useActivityStore, type ActivityKind } from "@/stores/activity-store";
import type {
  ActivitiesResponse,
  ActivityResult,
  AuthStatus,
  CompleteResult,
  GetPromptResult,
  ReadResourceResult,
  ToolResult,
  Transport,
} from "./types";
import { trpc } from "./trpc";

/* ------------------------------------------------------------------ */
/* Error class (preserves the same interface consumers rely on)        */
/* ------------------------------------------------------------------ */

class ApiError extends Error {
  status: number;
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

function wrapError(e: unknown): Error {
  if (e instanceof TRPCClientError) {
    const data = e.data as
      | { code?: string; httpStatus?: number; [key: string]: unknown }
      | undefined;
    if (!data?.code) {
      return new Error(e.message || "Network error");
    }
    const statusMap: Record<string, number> = {
      BAD_REQUEST: 400,
      NOT_FOUND: 404,
      CONFLICT: 409,
      INTERNAL_SERVER_ERROR: 500,
      METHOD_NOT_SUPPORTED: 405,
    };
    const responseBody =
      typeof data === "object" && data !== null ? data : undefined;
    return new ApiError(
      data.httpStatus ?? statusMap[data.code] ?? 500,
      e.message,
      responseBody,
    );
  }
  if (e instanceof Error) {
    return e;
  }
  return new Error(String(e));
}

/* ------------------------------------------------------------------ */
/* Activity helper                                                     */
/* ------------------------------------------------------------------ */

function pushActivities<T>(
  serverName: string,
  resp: ActivitiesResponse<T>,
): ActivityResult<T>[] {
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
    return trpc.health.check.query();
  },

  servers(): Promise<ServersListResponse> {
    return trpc.servers.list.query() as Promise<ServersListResponse>;
  },

  async discover(
    name: string,
    signal?: AbortSignal,
  ): Promise<ActivityResult[]> {
    try {
      const resp = await trpc.servers.discover.mutate(
        { serverName: name },
        { signal },
      );
      return pushActivities(name, resp as ActivitiesResponse);
    } catch (e) {
      throw wrapError(e);
    }
  },

  async callTool(
    name: string,
    body:
      | { name: string; arguments?: Record<string, unknown> }
      | Array<{ name: string; arguments?: Record<string, unknown> }>,
  ): Promise<ActivityResult<ToolResult>[]> {
    try {
      const resp = await trpc.servers.callTool.mutate({
        serverName: name,
        items: body,
      });
      return pushActivities<ToolResult>(
        name,
        resp as ActivitiesResponse<ToolResult>,
      );
    } catch (e) {
      throw wrapError(e);
    }
  },

  async readResource(
    name: string,
    body: { uri: string } | Array<{ uri: string }>,
  ): Promise<ActivityResult<ReadResourceResult>[]> {
    try {
      const resp = await trpc.servers.readResource.mutate({
        serverName: name,
        items: body,
      });
      return pushActivities<ReadResourceResult>(
        name,
        resp as ActivitiesResponse<ReadResourceResult>,
      );
    } catch (e) {
      throw wrapError(e);
    }
  },

  async getPrompt(
    name: string,
    body:
      | { name: string; arguments?: Record<string, string> }
      | Array<{ name: string; arguments?: Record<string, string> }>,
  ): Promise<ActivityResult<GetPromptResult>[]> {
    try {
      const resp = await trpc.servers.getPrompt.mutate({
        serverName: name,
        items: body,
      });
      return pushActivities<GetPromptResult>(
        name,
        resp as ActivitiesResponse<GetPromptResult>,
      );
    } catch (e) {
      throw wrapError(e);
    }
  },

  async complete(
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
    try {
      const resp = await trpc.servers.complete.mutate({
        serverName: name,
        items: body,
      });
      return pushActivities<CompleteResult>(
        name,
        resp as ActivitiesResponse<CompleteResult>,
      );
    } catch (e) {
      throw wrapError(e);
    }
  },

  async authStatus(name: string): Promise<AuthStatus> {
    try {
      return (await trpc.servers.authStatus.query({
        serverName: name,
      })) as AuthStatus;
    } catch (e) {
      throw wrapError(e);
    }
  },

  async authUrl(name: string): Promise<{ url: string | null }> {
    try {
      return await trpc.servers.authUrl.query({ serverName: name });
    } catch (e) {
      throw wrapError(e);
    }
  },

  async authLogout(
    name: string,
  ): Promise<ActivityResult<{ removed: boolean; file: string }>[]> {
    try {
      const resp = await trpc.servers.authLogout.mutate({
        serverName: name,
      });
      return pushActivities<{ removed: boolean; file: string }>(
        name,
        resp as ActivitiesResponse<{ removed: boolean; file: string }>,
      );
    } catch (e) {
      throw wrapError(e);
    }
  },

  async disconnect(name: string): Promise<ActivityResult<{ ok: true }>[]> {
    try {
      const resp = await trpc.servers.disconnect.mutate({
        serverName: name,
      });
      return pushActivities<{ ok: true }>(
        name,
        resp as ActivitiesResponse<{ ok: true }>,
      );
    } catch (e) {
      throw wrapError(e);
    }
  },

  /* Inspector config CRUD */

  async configServers(): Promise<{
    path: string;
    servers: Record<string, unknown>;
  }> {
    try {
      return await trpc.config.list.query();
    } catch (e) {
      throw wrapError(e);
    }
  },

  async configAddServer(
    name: string,
    config: Record<string, unknown>,
    force?: boolean,
  ): Promise<{ ok: true; name: string }> {
    try {
      return await trpc.config.add.mutate({ name, config, force });
    } catch (e) {
      throw wrapError(e);
    }
  },

  async configRemoveServer(name: string): Promise<{ ok: true; name: string }> {
    try {
      return await trpc.config.remove.mutate({ name });
    } catch (e) {
      throw wrapError(e);
    }
  },
};

export { ApiError };
