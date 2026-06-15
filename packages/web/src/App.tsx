import * as React from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";

import { AddServerDialog } from "@/components/add-server-dialog";
import { CommandPalette } from "@/components/command-palette";
import { ClassicShell } from "@/components/shell/classic-shell";
import { TooltipProvider } from "@/components/ui/tooltip";

import { useServersStore, type ApiState } from "@/stores/servers-store";
import {
  useConnectionStore,
  type ConnectionState,
} from "@/stores/connection-store";
import type { MCPServer } from "@/data/types";

import { OverviewPage } from "@/pages/overview";
import { ResourcesPage } from "@/pages/resources";
import { ToolsPage } from "@/pages/tools";
import { PromptsPage } from "@/pages/prompts";
import { CompletionsPage } from "@/pages/completions";
import { AuthPage } from "@/pages/auth";
import { ServersPage } from "@/pages/servers";
import { Empty } from "@/components/empty";

/**
 * Outlet context shared with every server-scoped page. Pages that need to
 * switch the active server (e.g. ServersPage) use `switchToServer`, which
 * preserves the current sub-route in the URL.
 */
export interface ServerLayoutContext {
  servers: MCPServer[];
  active: MCPServer;
  connection: ConnectionState;
  switchToServer: (next: MCPServer) => void;
}

export function useServerLayout(): ServerLayoutContext {
  return useOutletContext<ServerLayoutContext>();
}

export default function App() {
  const { servers, apiState, error, fetchServers } = useServersStore();

  React.useEffect(() => {
    void fetchServers();
  }, [fetchServers]);

  if (apiState === "loading" && servers.length === 0) {
    return (
      <div className="grid h-screen place-items-center text-muted-foreground">
        <div className="font-mono text-sm">loading…</div>
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <TooltipProvider>
        <div className="flex h-screen flex-col">
          <NoServersScreen
            apiState={apiState}
            error={error}
            onRetry={fetchServers}
          />
        </div>
      </TooltipProvider>
    );
  }

  const fallback = `/${encodeURIComponent(servers[0]!.id)}/overview`;

  return (
    <TooltipProvider delayDuration={300}>
      <Routes>
        <Route path="/" element={<Navigate to={fallback} replace />} />
        <Route path=":serverName" element={<ServerLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="resources" element={<ResourcesPage />} />
          <Route path="tools" element={<ToolsPage />} />
          <Route path="prompts" element={<PromptsPage />} />
          <Route path="completions" element={<CompletionsPage />} />
          <Route path="auth" element={<AuthPage />} />
          <Route path="servers" element={<ServersRouteElement />} />
        </Route>
        <Route path="*" element={<Navigate to={fallback} replace />} />
      </Routes>
    </TooltipProvider>
  );
}

function ServerLayout() {
  const { serverName } = useParams<{ serverName: string }>();
  const { servers } = useServersStore();
  const setServer = useConnectionStore((s) => s.setServer);

  const active = React.useMemo(
    () => servers.find((s) => s.id === serverName) ?? null,
    [servers, serverName],
  );

  // Sync the active server into the connection store.
  React.useEffect(() => {
    if (active) setServer(active);
  }, [active, setServer]);

  if (!active) {
    return (
      <Navigate
        to={`/${encodeURIComponent(servers[0]!.id)}/overview`}
        replace
      />
    );
  }

  return <ServerShell servers={servers} active={active} />;
}

function ServerShell({
  servers,
  active,
}: {
  servers: MCPServer[];
  active: MCPServer;
}) {
  const connectionState = useConnectionStore((s) => s.connectionState);
  const navigate = useNavigate();
  const location = useLocation();

  const switchToServer = React.useCallback(
    (next: MCPServer) => {
      // Preserve the current sub-route (e.g. `/old/tools` → `/new/tools`).
      const segments = location.pathname.split("/").filter(Boolean);
      const subPath = segments.slice(1).join("/") || "overview";
      navigate(`/${encodeURIComponent(next.id)}/${subPath}`);
    },
    [navigate, location.pathname],
  );

  const outletContext: ServerLayoutContext = {
    servers,
    active,
    connection: connectionState,
    switchToServer,
  };

  return (
    <>
      <ClassicShell
        servers={servers}
        active={active}
        onSelectServer={switchToServer}
        outletContext={outletContext}
      />
      <CommandPalette
        servers={servers}
        active={active}
        onSelectServer={switchToServer}
      />
    </>
  );
}

function ServersRouteElement() {
  const { servers, active, connection, switchToServer } = useServerLayout();
  return (
    <ServersPage
      servers={servers}
      active={active}
      onSelect={switchToServer}
      connection={connection}
    />
  );
}

function NoServersScreen({
  apiState,
  error,
  onRetry,
}: {
  apiState: ApiState;
  error?: string;
  onRetry: () => void;
}) {
  return (
    <div className="grid flex-1 place-items-center px-6 py-20">
      <div className="flex flex-col items-center">
        <Empty
          title={apiState === "offline" ? "API unreachable" : "No servers configured"}
          description={
            apiState === "offline"
              ? "The dashboard couldn't reach /api/trpc. Start the server with `mcp-inspector serve` (or `bun run dev:cli -- serve --no-open`)."
              : apiState === "error"
                ? error ?? "API returned an error."
                : "Add a server to .mcp.json in your cwd or home directory, use the button below, or reload."
          }
          actionLabel="Reload"
          onAction={onRetry}
        />
        {apiState !== "offline" && <AddServerDialog onAdded={onRetry} />}
      </div>
    </div>
  );
}
