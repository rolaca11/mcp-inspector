import * as React from "react";
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";

import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { NavTabs, type NavKey } from "@/components/nav-tabs";
import { TooltipProvider } from "@/components/ui/tooltip";

import {
  ServerProvider,
  useServer,
  type ConnectionState,
} from "@/contexts/server-context";
import { useServers } from "@/hooks/use-servers";
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
  const { servers, state: apiState, reload: reloadServers, error } = useServers();

  if (apiState === "loading" && servers.length === 0) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">
        <div className="text-sm font-mono">loading…</div>
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <TooltipProvider>
        <div className="min-h-screen flex flex-col">
          <NoServersScreen
            apiState={apiState}
            error={error}
            onRetry={reloadServers}
          />
        </div>
      </TooltipProvider>
    );
  }

  const fallback = `/${encodeURIComponent(servers[0]!.name)}/overview`;

  return (
    <TooltipProvider>
      <Routes>
        <Route path="/" element={<Navigate to={fallback} replace />} />
        <Route
          path=":serverName"
          element={
            <ServerLayout
              servers={servers}
              apiState={apiState}
              reloadServers={reloadServers}
            />
          }
        >
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

interface ServerLayoutProps {
  servers: MCPServer[];
  apiState: ReturnType<typeof useServers>["state"];
  reloadServers: () => void;
}

function ServerLayout({ servers, apiState, reloadServers }: ServerLayoutProps) {
  const { serverName } = useParams<{ serverName: string }>();
  const active = React.useMemo(
    () => servers.find((s) => s.name === serverName) ?? null,
    [servers, serverName],
  );

  if (!active) {
    return (
      <Navigate
        to={`/${encodeURIComponent(servers[0]!.name)}/overview`}
        replace
      />
    );
  }

  return (
    <ServerProvider key={active.name} server={active}>
      <ServerShell
        servers={servers}
        active={active}
        apiState={apiState}
        reloadServers={reloadServers}
      />
    </ServerProvider>
  );
}

interface ServerShellProps {
  servers: MCPServer[];
  active: MCPServer;
  apiState: ReturnType<typeof useServers>["state"];
  reloadServers: () => void;
}

function ServerShell({
  servers,
  active,
  apiState,
  reloadServers,
}: ServerShellProps) {
  const { data, state, rediscover, disconnect } = useServer();
  const navigate = useNavigate();
  const location = useLocation();

  const switchToServer = React.useCallback(
    (next: MCPServer) => {
      // Preserve the current sub-route (e.g. `/old/tools` → `/new/tools`).
      const segments = location.pathname.split("/").filter(Boolean);
      const subPath = segments.slice(1).join("/") || "overview";
      navigate(`/${encodeURIComponent(next.name)}/${subPath}`);
    },
    [navigate, location.pathname],
  );

  const counts: Partial<Record<NavKey, number>> = {
    resources: (data?.resources.length ?? 0) + (data?.resourceTemplates.length ?? 0),
    tools: data?.tools.length ?? 0,
    prompts: data?.prompts.length ?? 0,
    servers: servers.length,
  };

  const outletContext: ServerLayoutContext = {
    servers,
    active,
    connection: state,
    switchToServer,
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        servers={servers}
        active={active}
        onSelect={switchToServer}
        apiState={apiState}
        connection={state}
        onConnect={rediscover}
        onDisconnect={disconnect}
        onReloadServers={reloadServers}
      />
      <NavTabs serverName={active.name} counts={counts} />

      <main className="flex-1">
        <Outlet context={outletContext} />
      </main>

      <Footer />
    </div>
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
  apiState: ReturnType<typeof useServers>["state"];
  error?: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex-1 grid place-items-center px-6 py-20">
      <Empty
        title={apiState === "offline" ? "API unreachable" : "No servers configured"}
        description={
          apiState === "offline"
            ? "The dashboard couldn't reach /api. Start the server with `mcp-inspector serve` (or `pnpm dev -- serve --no-open`)."
            : apiState === "error"
              ? error ?? "API returned an error."
              : "Add a server to .mcp.json in your cwd or home directory and reload."
        }
        actionLabel="Reload"
        onAction={onRetry}
      />
    </div>
  );
}
