/**
 * Loads the named-server list from `/api/servers`. No fallback fixtures —
 * if the API is unreachable the UI shows an empty state and the user can
 * retry / start `mcp-inspector serve`.
 */

import * as React from "react";

import { api, ApiError } from "@/data/api";
import type { MCPServer } from "@/data/types";

export type ApiState = "loading" | "ok" | "offline" | "error";

interface UseServersResult {
  servers: MCPServer[];
  state: ApiState;
  error?: string;
  reload: () => void;
}

export function useServers(): UseServersResult {
  const [servers, setServers] = React.useState<MCPServer[]>([]);
  const [state, setState] = React.useState<ApiState>("loading");
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState("loading");
    api
      .servers()
      .then((r) => {
        if (cancelled) return;
        setServers(
          r.servers.map<MCPServer>((s) => ({
            name: s.name,
            source: s.source,
            transport: s.transport,
            target: s.target,
            ...(s.args ? { args: s.args } : {}),
            ...(s.env ? { env: s.env } : {}),
            ...(s.cwd ? { cwd: s.cwd } : {}),
            ...(s.headers ? { headers: s.headers } : {}),
          })),
        );
        setState("ok");
        setError(undefined);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setServers([]);
        if (e instanceof ApiError) {
          setState("error");
          setError(e.message);
        } else {
          setState("offline");
          setError(undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return {
    servers,
    state,
    ...(error ? { error } : {}),
    reload: () => setTick((t) => t + 1),
  };
}
