/**
 * Zustand store for the list of configured MCP servers, loaded from
 * `/api/servers`. Replaces the former `useServers()` React hook.
 */

import { create } from "zustand";

import { api, ApiError } from "@/data/api";
import type { MCPServer } from "@/data/types";

export type ApiState = "loading" | "ok" | "offline" | "error";

interface ServersState {
  servers: MCPServer[];
  apiState: ApiState;
  error?: string;
  fetchServers(): Promise<void>;
}

/** Monotonically increasing request counter to ignore stale responses. */
let requestId = 0;

export const useServersStore = create<ServersState>((set) => ({
  servers: [],
  apiState: "loading",
  error: undefined,

  async fetchServers() {
    const thisRequest = ++requestId;
    set({ apiState: "loading" });
    try {
      const r = await api.servers();
      if (thisRequest !== requestId) return; // stale
      set({
        servers: r.servers.map<MCPServer>((s) => ({
          name: s.name,
          source: s.source,
          transport: s.transport,
          target: s.target,
          ...(s.args ? { args: s.args } : {}),
          ...(s.env ? { env: s.env } : {}),
          ...(s.cwd ? { cwd: s.cwd } : {}),
          ...(s.headers ? { headers: s.headers } : {}),
        })),
        apiState: "ok",
        error: undefined,
      });
    } catch (e: unknown) {
      if (thisRequest !== requestId) return; // stale
      if (e instanceof ApiError) {
        set({ servers: [], apiState: "error", error: e.message });
      } else {
        set({ servers: [], apiState: "offline", error: undefined });
      }
    }
  },
}));
