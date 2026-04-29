/**
 * Zustand store for the active server connection. Owns the live `discover()`
 * result so every page reads the same shared state. Replaces the former
 * `ServerProvider` React context.
 *
 * Call `setServer(server)` when the active server changes -- it resets all
 * state and triggers a fresh discover, handling the same role as the old
 * `<ServerProvider key={name}>` pattern.
 */

import { create } from "zustand";

import { ApiError, api } from "@/data/api";
import type { DiscoverResult, MCPServer } from "@/data/types";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

interface ConnectionStoreState {
  server: MCPServer | null;
  data: DiscoverResult | null;
  connectionState: ConnectionState;
  error?: string;
  lastDiscoveredAt?: string;
  loading: boolean;

  setServer(server: MCPServer): void;
  rediscover(): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * AbortController for the in-flight discover request. Kept outside of the
 * Zustand state because it is not serializable and changes to it should
 * not trigger re-renders.
 */
let inFlight: AbortController | null = null;

async function runDiscover(
  serverName: string,
  silent: boolean,
  set: (
    partial:
      | Partial<ConnectionStoreState>
      | ((s: ConnectionStoreState) => Partial<ConnectionStoreState>),
  ) => void,
) {
  inFlight?.abort();
  const ctrl = new AbortController();
  inFlight = ctrl;

  if (!silent) set({ connectionState: "connecting" });
  set({ error: undefined });

  try {
    const r = await api.discover(serverName, ctrl.signal);
    if (ctrl.signal.aborted) return;
    set({
      data: r,
      lastDiscoveredAt: new Date().toISOString(),
      connectionState: "connected",
      loading: false,
    });
  } catch (e) {
    if (ctrl.signal.aborted) return;
    if (e instanceof ApiError) {
      set({
        error: e.message,
        connectionState: "error",
        data: null,
        loading: false,
      });
    } else {
      // Network failure (API not reachable, no `serve` running).
      set({
        error: undefined,
        connectionState: "disconnected",
        data: null,
        loading: false,
      });
    }
  }
}

export const useConnectionStore = create<ConnectionStoreState>((set) => ({
  server: null,
  data: null,
  connectionState: "idle",
  error: undefined,
  lastDiscoveredAt: undefined,
  loading: false,

  setServer(server: MCPServer) {
    const current = useConnectionStore.getState().server;
    if (current?.name === server.name) {
      // Same server -- just update the reference in case the object changed.
      set({ server });
      return;
    }
    // New server -- reset and auto-discover.
    inFlight?.abort();
    set({
      server,
      data: null,
      connectionState: "connecting",
      error: undefined,
      lastDiscoveredAt: undefined,
      loading: true,
    });
    void runDiscover(server.name, true, set);
  },

  async rediscover() {
    const { server } = useConnectionStore.getState();
    if (!server) return;
    set({ loading: true });
    await runDiscover(server.name, false, set);
  },

  async disconnect() {
    const { server } = useConnectionStore.getState();
    if (!server) return;
    try {
      await api.disconnect(server.name);
    } catch {
      /* ignore */
    }
    set({
      data: null,
      connectionState: "disconnected",
      error: undefined,
    });
  },
}));
