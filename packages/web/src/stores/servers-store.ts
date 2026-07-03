/**
 * Zustand store for the list of configured MCP servers, loaded from
 * the `servers.list` tRPC procedure. Replaces the former `useServers()` React
 * hook.
 */

import { create } from "zustand";

import { api, ApiError } from "@/data/api";
import type { ConfigSource, MCPServer } from "@/data/types";

export type ApiState = "loading" | "ok" | "offline" | "error";

interface ServersState {
  servers: MCPServer[];
  /** Every config file the backend read, including ones with no servers. */
  sources: ConfigSource[];
  apiState: ApiState;
  error?: string;
  fetchServers(): Promise<void>;
}

/** Monotonically increasing request counter to ignore stale responses. */
let requestId = 0;

export const useServersStore = create<ServersState>((set) => ({
  servers: [],
  sources: [],
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
          id: s.id,
          name: s.name,
          source: s.source,
          sourceLabel: (s.sourceLabel as MCPServer["sourceLabel"]) ?? "global",
          transport: s.transport,
          target: s.target,
          ...(s.args ? { args: s.args } : {}),
          ...(s.env ? { env: s.env } : {}),
          ...(s.cwd ? { cwd: s.cwd } : {}),
          ...(s.headers ? { headers: s.headers } : {}),
        })),
        sources: r.sources.map<ConfigSource>((src) => ({
          path: src.path,
          label: (src.label as ConfigSource["label"]) ?? "global",
          serverCount: src.serverCount,
        })),
        apiState: "ok",
        error: undefined,
      });
    } catch (e: unknown) {
      if (thisRequest !== requestId) return; // stale
      if (e instanceof ApiError) {
        set({ servers: [], sources: [], apiState: "error", error: e.message });
      } else {
        set({
          servers: [],
          sources: [],
          apiState: "offline",
          error: (e as Error).message || "Network error — is the inspector server running?",
        });
      }
    }
  },
}));
