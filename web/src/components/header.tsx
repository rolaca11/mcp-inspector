import {
  Bell,
  HelpCircle,
  Loader2,
  Plug,
  Power,
  RefreshCcw,
  Search,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Logo } from "@/components/logo";
import { ServerSelector } from "@/components/server-selector";
import { SourceSelector } from "@/components/source-selector";
import { StatusDot } from "@/components/status-dot";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ConnectionState } from "@/contexts/server-context";
import type { ApiState } from "@/hooks/use-servers";
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
}: HeaderProps) {
  const grouped = new Map<string, number>();
  for (const s of servers) {
    grouped.set(s.source, (grouped.get(s.source) ?? 0) + 1);
  }
  const sources = Array.from(grouped.entries()).map(([path, count]) => ({
    path,
    serverCount: count,
    origin: path.includes("/.mcp.json") && !path.includes("code/")
      ? ("home" as const)
      : ("cwd" as const),
  }));

  return (
    <header className="border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
      <div className="mx-auto flex h-[4.5rem] max-w-[1800px] items-center gap-5 px-8">
        {/* Left: logo + breadcrumbs */}
        <div className="flex items-center gap-4 min-w-0">
          <Logo />
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

        {/* Right: API badge, search, help, notifications, avatar */}
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

          <button
            type="button"
            className="hidden md:inline-flex h-9 items-center gap-2.5 rounded-md border border-border/60 bg-card/40 pl-3 pr-2 text-sm text-muted-foreground transition-colors hover:bg-card/70 cursor-pointer"
          >
            <Search className="size-3.5" />
            <span>Search</span>
            <span className="ml-6 inline-flex items-center gap-1">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>

          <Button variant="ghost" size="sm" asChild className="hidden lg:inline-flex">
            <a
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noreferrer"
            >
              Docs
            </a>
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Help">
                <HelpCircle className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Help &amp; keyboard shortcuts
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Notifications">
                <Bell className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Notifications</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ml-1 cursor-pointer rounded-full ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <Avatar>
                  <AvatarFallback className="bg-gradient-to-br from-emerald-400/40 to-blue-400/40 text-foreground">
                    LS
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex flex-col items-start gap-0.5">
                <span className="text-foreground text-sm normal-case font-medium">
                  Local user
                </span>
                <span className="text-xs tracking-normal normal-case text-muted-foreground">
                  loopback · 127.0.0.1
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onReloadServers}>
                <RefreshCcw className="size-4" />
                Reload .mcp.json
                <DropdownMenuShortcut>R</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
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
