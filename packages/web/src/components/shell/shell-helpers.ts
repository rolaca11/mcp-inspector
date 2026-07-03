import * as React from "react";
import { useNavigate } from "react-router-dom";

import type { NavKey } from "@/components/nav-tabs";
import type { ConnectionState } from "@/stores/connection-store";
import { useServersStore } from "@/stores/servers-store";
import type { DiscoverResult, MCPServer } from "@/data/types";

export interface SourceEntry {
  path: string;
  serverCount: number;
  label: string;
}

/**
 * The `.mcp.json` source files as reported by the backend — every file that
 * was read is listed, including ones that declare no servers (e.g. a fresh
 * inspector config), so users can always find and add to them.
 */
export function useSources(
  servers: MCPServer[],
  active: MCPServer,
  onSelect: (server: MCPServer) => void,
) {
  const sources = useServersStore((s) => s.sources);
  const navigate = useNavigate();

  const sourceServers = React.useMemo(
    () => servers.filter((server) => server.source === active.source),
    [servers, active.source],
  );

  const handleSourceSelect = React.useCallback(
    (path: string) => {
      const next = servers.find((server) => server.source === path);
      if (next) {
        if (next.id !== active.id) onSelect(next);
      } else {
        // Empty source — nothing to activate; go to the servers page where
        // the file is listed and servers can be added.
        navigate(`/${encodeURIComponent(active.id)}/servers`);
      }
    },
    [servers, active.id, onSelect, navigate],
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
