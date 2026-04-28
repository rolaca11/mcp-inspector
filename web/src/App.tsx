import * as React from "react";

import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { NavTabs, type NavKey } from "@/components/nav-tabs";
import { TooltipProvider } from "@/components/ui/tooltip";

import { ServerProvider, useServer } from "@/contexts/server-context";
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

export default function App() {
  const { servers, state: apiState, reload: reloadServers, error } = useServers();
  const [activeName, setActiveName] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<NavKey>("overview");

  React.useEffect(() => {
    if (servers.length === 0) {
      setActiveName(null);
      return;
    }
    if (!activeName || !servers.find((s) => s.name === activeName)) {
      setActiveName(servers[0]!.name);
    }
  }, [servers, activeName]);

  const active = React.useMemo<MCPServer | null>(
    () => servers.find((s) => s.name === activeName) ?? null,
    [servers, activeName],
  );

  if (apiState === "loading" && servers.length === 0) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">
        <div className="text-sm font-mono">loading…</div>
      </div>
    );
  }

  if (!active) {
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

  return (
    <TooltipProvider>
      <ServerProvider key={active.name} server={active}>
        <Shell
          servers={servers}
          active={active}
          tab={tab}
          onSelect={(s) => setActiveName(s.name)}
          onTabChange={setTab}
          apiState={apiState}
          reloadServers={reloadServers}
        />
      </ServerProvider>
    </TooltipProvider>
  );
}

interface ShellProps {
  servers: MCPServer[];
  active: MCPServer;
  tab: NavKey;
  onSelect: (s: MCPServer) => void;
  onTabChange: (k: NavKey) => void;
  apiState: ReturnType<typeof useServers>["state"];
  reloadServers: () => void;
}

function Shell({
  servers,
  active,
  tab,
  onSelect,
  onTabChange,
  apiState,
  reloadServers,
}: ShellProps) {
  const { data, state, rediscover, disconnect } = useServer();

  const counts: Partial<Record<NavKey, number>> = {
    resources: (data?.resources.length ?? 0) + (data?.resourceTemplates.length ?? 0),
    tools: data?.tools.length ?? 0,
    prompts: data?.prompts.length ?? 0,
    servers: servers.length,
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        servers={servers}
        active={active}
        onSelect={onSelect}
        apiState={apiState}
        connection={state}
        onConnect={rediscover}
        onDisconnect={disconnect}
        onReloadServers={reloadServers}
      />
      <NavTabs active={tab} onChange={onTabChange} counts={counts} />

      <main className="flex-1">
        {tab === "overview" && <OverviewPage onTabChange={onTabChange} />}
        {tab === "resources" && <ResourcesPage />}
        {tab === "tools" && <ToolsPage />}
        {tab === "prompts" && <PromptsPage />}
        {tab === "completions" && <CompletionsPage />}
        {tab === "auth" && <AuthPage />}
        {tab === "servers" && (
          <ServersPage
            servers={servers}
            active={active}
            onSelect={onSelect}
            connection={state}
          />
        )}
      </main>

      <Footer />
    </div>
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
