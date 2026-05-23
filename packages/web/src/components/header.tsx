import {Loader2, Plug, RefreshCw, X,} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Logo} from "@/components/logo";
import {ServerSelector} from "@/components/server-selector";
import {SourceSelector} from "@/components/source-selector";
import type {ConnectionState} from "@/stores/connection-store";
import type {MCPServer} from "@/data/types";

interface HeaderProps {
  servers: MCPServer[];
  active: MCPServer;
  onSelect: (server: MCPServer) => void;
  connection: ConnectionState;
  onConnect: () => void;
  onRediscover: () => void;
  children?: React.ReactNode;
}

export function Header({
  servers,
  active,
  onSelect,
  connection,
  onConnect,
  onRediscover,
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
  const sourceServers = servers.filter((server) => server.source === active.source);

  function handleSourceSelect(path: string) {
    const next = servers.find((server) => server.source === path);
    if (next && next.id !== active.id) onSelect(next);
  }

  return (
    <header className="border-b border-border/60 bg-chrome sticky top-0 z-40">
      <div className="mx-auto flex h-18 max-w-450 items-center gap-5 px-8">
        {/* Left: logo + breadcrumbs */}
        <div className="flex items-center gap-4 min-w-0">
          <Logo size={32} className="text-foreground" />
          <nav className="flex items-center gap-1.5 text-muted-foreground/70 text-base">
            <SourceSelector
              sources={sources}
              activePath={active.source}
              onSelect={handleSourceSelect}
            />
            <span aria-hidden className="select-none px-0.5">/</span>
            <ServerSelector
              servers={sourceServers}
              active={active}
              onSelect={onSelect}
              activeConnection={connection}
            />
            <span aria-hidden className="select-none px-0.5">/</span>
            <span className="font-mono pt-1 text-sm truncate max-w-[18rem] text-foreground/70">
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
          onRediscover={onRediscover}
        />
        {window.location.protocol === "app:" && (
          <button
            type="button"
            onClick={() => window.close()}
            className="ml-auto inline-flex items-center justify-center p-1.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {children}
    </header>
  );
}

function ConnectButton({
  state,
  onConnect,
  onRediscover,
}: {
  state: ConnectionState;
  onConnect: () => void;
  onRediscover: () => void;
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
      <button
        type="button"
        onClick={onRediscover}
        className="ml-2 inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <RefreshCw className="size-4" />
      </button>
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
