/**
 * Owns the live `discover()` result for the active server. Every page reads
 * its slice (resources, tools, prompts, capabilities, …) from the same
 * shared state so we discover once per server, not per page.
 *
 * Discover is run again whenever:
 *   - the active server name changes,
 *   - the user clicks "Connect" / "Re-discover" in the chrome,
 *   - or a tool/resource/prompt action might have changed the server's view
 *     (callers can pass `{ rediscover: true }` to mutating operations).
 */

import * as React from "react";

import { ApiError, api } from "@/data/api";
import type { DiscoverResult, MCPServer } from "@/data/types";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

interface ServerContextValue {
  /** The currently selected server. Always defined when the provider mounts. */
  server: MCPServer;
  /** Latest discover() result. Null until the first successful discover. */
  data: DiscoverResult | null;
  state: ConnectionState;
  error?: string;
  /** When did `data` arrive? Used for "last connected" timestamps. */
  lastDiscoveredAt?: string;
  /** True while a discover() is in flight. */
  loading: boolean;
  /** Re-run discover. */
  rediscover(): Promise<void>;
  /** Drop the cached session on the server. */
  disconnect(): Promise<void>;
}

const ServerContext = React.createContext<ServerContextValue | null>(null);

interface ProviderProps {
  server: MCPServer;
  children: React.ReactNode;
}

export function ServerProvider({ server, children }: ProviderProps) {
  const [data, setData] = React.useState<DiscoverResult | null>(null);
  const [state, setState] = React.useState<ConnectionState>("idle");
  const [error, setError] = React.useState<string | undefined>();
  const [lastDiscoveredAt, setLastDiscoveredAt] = React.useState<string>();

  const inFlight = React.useRef<AbortController | null>(null);

  const run = React.useCallback(
    async (silent = false) => {
      inFlight.current?.abort();
      const ctrl = new AbortController();
      inFlight.current = ctrl;
      if (!silent) setState("connecting");
      setError(undefined);
      try {
        const r = await api.discover(server.name, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setData(r);
        setLastDiscoveredAt(new Date().toISOString());
        setState("connected");
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (e instanceof ApiError) {
          setError(e.message);
          setState("error");
        } else {
          // Network failure (API not reachable, no `serve` running).
          setError(undefined);
          setState("disconnected");
        }
        setData(null);
      }
    },
    [server.name],
  );

  React.useEffect(() => {
    void run();
    return () => inFlight.current?.abort();
  }, [run]);

  const value = React.useMemo<ServerContextValue>(
    () => ({
      server,
      data,
      state,
      ...(error != null ? { error } : {}),
      ...(lastDiscoveredAt != null ? { lastDiscoveredAt } : {}),
      loading: state === "connecting",
      rediscover: () => run(),
      async disconnect() {
        try {
          await api.disconnect(server.name);
        } catch {
          /* ignore */
        }
        setData(null);
        setState("disconnected");
        setError(undefined);
      },
    }),
    [server, data, state, error, lastDiscoveredAt, run],
  );

  return (
    <ServerContext.Provider value={value}>{children}</ServerContext.Provider>
  );
}

export function useServer(): ServerContextValue {
  const v = React.useContext(ServerContext);
  if (!v) throw new Error("useServer must be used inside <ServerProvider>");
  return v;
}
