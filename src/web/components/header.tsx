import {
  Loader2,
  Plug,
  Power,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ServerSelector } from "@/components/server-selector";
import { SourceSelector } from "@/components/source-selector";
import { StatusDot } from "@/components/status-dot";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ConnectionState } from "@/stores/connection-store";
import type { ApiState } from "@/stores/servers-store";
import type { MCPServer } from "@/data/types";

interface HeaderProps {
  servers: MCPServer[];
  active: MCPServer;
  onSelect: (server: MCPServer) => void;
  apiState: ApiState;
  connection: ConnectionState;
  onConnect: () => void;
  onDisconnect: () => void;
  onReloadServers: () => void;
  children?: React.ReactNode;
}

const API_STATE_TONE: Record<
  ApiState,
  "success" | "warning" | "destructive" | "muted"
> = {
  ok: "success",
  loading: "muted",
  offline: "warning",
  error: "destructive",
};

const API_STATE_LABEL: Record<ApiState, string> = {
  ok: "live",
  loading: "loading",
  offline: "offline",
  error: "API error",
};

export function Header({
  servers,
  active,
  onSelect,
  apiState,
  connection,
  onConnect,
  onDisconnect,
  onReloadServers,
  children,
}: HeaderProps) {
  const grouped = new Map<string, { count: number; label: string }>();
  for (const s of servers) {
    const entry = grouped.get(s.source) ?? { count: 0, label: s.sourceLabel };
    entry.count++;
    grouped.set(s.source, entry);
  }
  const sources = Array.from(grouped.entries()).map(([path, { count, label }]) => ({
    path,
    serverCount: count,
    label,
  }));

  return (
    <header className="border-b border-border/60 bg-chrome sticky top-0 z-40">
      <div className="mx-auto flex h-[4.5rem] max-w-[1800px] items-center gap-5 px-8">
        {/* Left: logo + breadcrumbs */}
        <div className="flex items-center gap-4 min-w-0">
          <nav className="flex items-center gap-1.5 text-muted-foreground/70 text-base">
            <SourceSelector
              sources={sources}
              activePath={active.source}
              onSelect={() => {}}
            />
            <span aria-hidden className="select-none px-0.5">/</span>
            <ServerSelector
              servers={servers}
              active={active}
              onSelect={onSelect}
              activeConnection={connection}
            />
            <span aria-hidden className="select-none px-0.5">/</span>
            <span className="font-mono text-xs truncate max-w-[18rem] text-foreground/70">
              {active.transport === "stdio"
                ? active.target
                : active.target.replace(/^https?:\/\//, "")}
            </span>
          </nav>
        </div>

        {/* Primary action */}
        <ConnectButton
          state={connection}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
        />

        <div className="flex-1" />

        {/* Right: API status badge */}
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onReloadServers}
                className="cursor-pointer"
              >
                <Badge
                  variant={
                    apiState === "offline"
                      ? "warning"
                      : apiState === "error"
                        ? "destructive"
                        : "muted"
                  }
                  className="hidden md:inline-flex"
                >
                  <StatusDot
                    tone={API_STATE_TONE[apiState]}
                    pulse={apiState === "loading"}
                  />
                  {API_STATE_LABEL[apiState]}
                </Badge>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {apiState === "ok"
                ? "Connected to /api — click to reload"
                : apiState === "offline"
                  ? "API unreachable — click to retry"
                  : apiState === "error"
                    ? "API error — click to retry"
                    : "Loading…"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {children}
    </header>
  );
}

function ConnectButton({
  state,
  onConnect,
  onDisconnect,
}: {
  state: ConnectionState;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  if (state === "connecting") {
    return (
      <Button size="sm" variant="secondary" disabled className="ml-2 gap-1.5">
        <Loader2 className="size-3.5 animate-spin" />
        Connecting…
      </Button>
    );
  }
  if (state === "connected") {
    return (
      <Button
        size="sm"
        variant="secondary"
        className="ml-2 gap-1.5"
        onClick={onDisconnect}
      >
        <Power className="size-3.5" />
        Disconnect
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant="success"
      className="ml-2 gap-1.5"
      onClick={onConnect}
    >
      <Plug className="size-3.5" />
      {state === "error" ? "Retry" : "Connect"}
    </Button>
  );
}
