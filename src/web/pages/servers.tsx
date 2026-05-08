import * as React from "react";
import {FolderTree, Trash2} from "lucide-react";

import {AddServerDialog} from "@/components/add-server-dialog";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardDescription, CardHeader, CardTitle,} from "@/components/ui/card";
import {Empty} from "@/components/empty";
import {PageShell} from "@/components/page-shell";
import {StatusDot} from "@/components/status-dot";
import {TransportIcon, transportLabel} from "@/components/transport-icon";
import {api} from "@/data/api";
import {type ConnectionState, useConnectionStore} from "@/stores/connection-store";
import {useServersStore} from "@/stores/servers-store";
import type {MCPServer} from "@/data/types";
import {cn, formatRelativeTime} from "@/lib/utils";

interface ServersPageProps {
  servers: MCPServer[];
  active: MCPServer;
  onSelect: (server: MCPServer) => void;
  /** Connection state for the currently active server. */
  connection: ConnectionState;
}

const TONE: Record<ConnectionState, "success" | "warning" | "destructive" | "muted"> = {
  connected: "success",
  connecting: "warning",
  error: "destructive",
  disconnected: "muted",
  idle: "muted",
};

export function ServersPage({
  servers,
  active,
  onSelect,
  connection,
}: ServersPageProps) {
  const { data, lastDiscoveredAt, error } = useConnectionStore();
  const fetchServers = useServersStore((s) => s.fetchServers);
  const [removing, setRemoving] = React.useState<string | null>(null);

  async function handleRemove(serverName: string) {
    setRemoving(serverName);
    try {
      await api.configRemoveServer(serverName);
      await fetchServers();
    } catch {
      // errors are transient — next fetch will reflect reality
    } finally {
      setRemoving(null);
    }
  }

  const sources = Array.from(
    servers.reduce((map, s) => {
      const list = map.get(s.source) ?? [];
      list.push(s);
      map.set(s.source, list);
      return map;
    }, new Map<string, MCPServer[]>()),
  );

  const addButton = <AddServerDialog onAdded={fetchServers} />;

  if (servers.length === 0) {
    return (
      <PageShell title="Servers" actions={addButton}>
        <Empty
          icon={FolderTree}
          title="No servers configured"
          description="Add a server to .mcp.json in your cwd or home directory, or use the button above."
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Servers"
      description="Resolved view of every named server across your `.mcp.json` files. Project-local entries override user-global ones."
      actions={addButton}
    >
      <div className="grid lg:grid-cols-2 gap-4">
      {sources.map(([path, list]) => (
        <Card key={path}>
          <CardHeader>
            <div className="flex flex-col gap-1 min-w-0">
              <CardTitle className="flex items-center gap-2">
                <FolderTree className="size-4 text-muted-foreground" />
                <span className="font-mono text-foreground">{path}</span>
              </CardTitle>
              <CardDescription>
                {list.length} server{list.length === 1 ? "" : "s"} loaded from this file.
              </CardDescription>
            </div>
          </CardHeader>
          <div className="divide-y divide-border/50">
            {list.map((s) => {
              const isActive = s.name === active.name;
              const isInspector = s.sourceLabel === "inspector";
              const tone = isActive ? TONE[connection] : "muted";
              const statusLabel = !isActive
                ? "select to inspect"
                : connection === "connected" && lastDiscoveredAt
                  ? `connected · discovered ${formatRelativeTime(lastDiscoveredAt)}`
                  : connection === "connecting"
                    ? "connecting…"
                    : connection === "error"
                      ? `error: ${error ?? "connection failed"}`
                      : error
                        ? `disconnected: ${error}`
                        : "disconnected";
              return (
                <div
                  key={s.name}
                  className={cn(
                    "flex w-full items-start gap-5 px-6 py-5 text-left transition-colors",
                    isActive ? "bg-accent/40" : "hover:bg-accent/20",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(s)}
                    className="flex flex-1 items-start gap-5 min-w-0 cursor-pointer"
                  >
                    <StatusDot tone={tone} pulse={isActive && (connection === "connected" || connection === "connecting")} className="mt-2" />
                    <div className="flex-1 min-w-0 space-y-2.5">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-base font-medium">{s.name}</span>
                        {isActive && data?.server?.title && (
                          <span className="text-sm text-muted-foreground">
                            · {data.server.title}
                          </span>
                        )}
                        <Badge variant="muted" className="font-mono">
                          <TransportIcon transport={s.transport} />
                          {transportLabel(s.transport)}
                        </Badge>
                        {isActive && data?.server?.version && (
                          <Badge variant="muted" className="font-mono">
                            {data.server.name}@{data.server.version}
                          </Badge>
                        )}
                      </div>
                      <div className="font-mono text-sm text-muted-foreground truncate">
                        {s.target}
                      </div>
                      <div className="text-xs text-muted-foreground/80">
                        {statusLabel}
                      </div>
                    </div>
                  </button>
                  {isInspector && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="mt-1.5 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={removing === s.name}
                      onClick={() => handleRemove(s.name)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ))}
      </div>
    </PageShell>
  );
}
