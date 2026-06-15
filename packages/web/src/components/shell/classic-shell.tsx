import * as React from "react";
import { Outlet } from "react-router-dom";

import { AppSidebar } from "@/components/shell/app-sidebar";
import { TopToolbar } from "@/components/shell/top-toolbar";
import { StatusBar } from "@/components/shell/status-bar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { OAuthBanner } from "@/components/shell/oauth-banner";
import { computeCounts } from "@/components/shell/shell-helpers";
import { useConnectionStore } from "@/stores/connection-store";
import { useUIStore } from "@/stores/ui-store";
import type { ServerLayoutContext } from "@/App";
import type { MCPServer } from "@/data/types";

export interface ShellProps {
  servers: MCPServer[];
  active: MCPServer;
  onSelectServer: (server: MCPServer) => void;
  outletContext: ServerLayoutContext;
}

/**
 * Deliverable 1 — the original dark/violet language, restructured as a real
 * desktop app: full-height frame with a left sidebar, a non-scrolling top
 * toolbar, a single scrolling content region, a bottom status bar, and a mobile
 * bottom tab bar. No website footer; the window owns no scroll.
 */
export function ClassicShell({
  servers,
  active,
  onSelectServer,
  outletContext,
}: ShellProps) {
  const { data, connectionState, rediscover, pendingAuthUrl } =
    useConnectionStore();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const counts = computeCounts(data, servers.length);

  return (
    <div
      className="flex h-screen overflow-hidden bg-background"
      style={
        {
          "--chrome-top": "3rem",
          "--chrome-bottom": "1.75rem",
        } as React.CSSProperties
      }
    >
      <div
        className="hidden h-full shrink-0 lg:block"
        style={{ width: sidebarCollapsed ? "3.5rem" : "16rem" }}
      >
        <AppSidebar
          servers={servers}
          active={active}
          onSelect={onSelectServer}
          connection={connectionState}
          counts={counts}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
        />
      </div>

      <div className="flex h-full min-w-0 flex-1 flex-col">
        <TopToolbar
          connection={connectionState}
          onConnect={() => void rediscover()}
          onRediscover={() => void rediscover()}
        />
        {pendingAuthUrl && <OAuthBanner url={pendingAuthUrl} />}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <Outlet context={outletContext} />
        </main>
        <StatusBar />
        <BottomNav serverName={active.id} counts={counts} />
      </div>
    </div>
  );
}
