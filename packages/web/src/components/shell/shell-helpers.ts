import * as React from "react";

import type { NavKey } from "@/components/nav-tabs";
import type { ConnectionState } from "@/stores/connection-store";
import type { DiscoverResult, MCPServer } from "@/data/types";

export interface SourceEntry {
  path: string;
  serverCount: number;
  label: string;
}

/** Group the configured servers by their `.mcp.json` source file. */
export function useSources(
  servers: MCPServer[],
  active: MCPServer,
  onSelect: (server: MCPServer) => void,
) {
  const sources = React.useMemo<SourceEntry[]>(() => {
    const grouped = new Map<string, { count: number; label: string }>();
    for (const s of servers) {
      const entry = grouped.get(s.source) ?? { count: 0, label: s.sourceLabel };
      entry.count++;
      grouped.set(s.source, entry);
    }
    return Array.from(grouped.entries()).map(([path, { count, label }]) => ({
      path,
      serverCount: count,
      label,
    }));
  }, [servers]);

  const sourceServers = React.useMemo(
    () => servers.filter((server) => server.source === active.source),
    [servers, active.source],
  );

  const handleSourceSelect = React.useCallback(
    (path: string) => {
      const next = servers.find((server) => server.source === path);
      if (next && next.id !== active.id) onSelect(next);
    },
    [servers, active.id, onSelect],
  );

  return { sources, sourceServers, handleSourceSelect };
}

/** Capability counts shown as nav badges + status-bar segments. */
export function computeCounts(
  data: DiscoverResult | null,
  serverCount: number,
): Partial<Record<NavKey, number>> {
  return {
    resources:
      (data?.resources.length ?? 0) + (data?.resourceTemplates.length ?? 0),
    tools: data?.tools.length ?? 0,
    prompts: data?.prompts.length ?? 0,
    servers: serverCount,
  };
}

export const CONNECTION_TONE: Record<
  ConnectionState,
  "success" | "warning" | "destructive" | "muted"
> = {
  connected: "success",
  connecting: "warning",
  error: "destructive",
  disconnected: "muted",
  idle: "muted",
};

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connected: "connected",
  connecting: "connecting",
  error: "error",
  disconnected: "disconnected",
  idle: "idle",
};

export function formatDuration(ms?: number | null): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

/** Strip the scheme from HTTP targets the way the old header did. */
export function displayTarget(server: MCPServer): string {
  return server.transport === "stdio"
    ? server.target
    : server.target.replace(/^https?:\/\//, "");
}
