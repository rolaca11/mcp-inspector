import { ExternalLink, FileCog, FolderTree, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CodeBlock } from "@/components/code-block";
import { Empty } from "@/components/empty";
import { PageShell } from "@/components/page-shell";
import { StatusDot } from "@/components/status-dot";
import { TransportIcon, transportLabel } from "@/components/transport-icon";
import type { ConnectionState } from "@/contexts/server-context";
import { useServer } from "@/contexts/server-context";
import type { MCPServer } from "@/data/types";
import { cn, formatRelativeTime } from "@/lib/utils";

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
  const { data, lastDiscoveredAt } = useServer();

  const sources = Array.from(
    servers.reduce((map, s) => {
      const list = map.get(s.source) ?? [];
      list.push(s);
      map.set(s.source, list);
      return map;
    }, new Map<string, MCPServer[]>()),
  );

  if (servers.length === 0) {
    return (
      <PageShell title="Servers">
        <Empty
          icon={FolderTree}
          title="No servers configured"
          description="Add a server to .mcp.json in your cwd or home directory."
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Servers"
      description="Resolved view of every named server across your `.mcp.json` files. Project-local entries override user-global ones."
      actions={
        <>
          <Button variant="outline" size="sm" disabled>
            <FileCog className="size-3.5" />
            Edit .mcp.json
          </Button>
          <Button size="sm" disabled>
            <Plus className="size-3.5" />
            Add server
          </Button>
        </>
      }
    >
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
            <Badge variant="muted">
              <ExternalLink className="size-3" />
              open
            </Badge>
          </CardHeader>
          <div className="divide-y divide-border/50">
            {list.map((s) => {
              const isActive = s.name === active.name;
              const tone = isActive ? TONE[connection] : "muted";
              const statusLabel = !isActive
                ? "select to inspect"
                : connection === "connected" && lastDiscoveredAt
                  ? `connected · discovered ${formatRelativeTime(lastDiscoveredAt)}`
                  : connection === "connecting"
                    ? "connecting…"
                    : connection === "error"
                      ? "connection error"
                      : "disconnected";
              return (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => onSelect(s)}
                  className={cn(
                    "flex w-full items-start gap-5 px-6 py-5 text-left transition-colors cursor-pointer",
                    isActive ? "bg-accent/40" : "hover:bg-accent/20",
                  )}
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
                  <Button
                    variant={isActive ? "secondary" : "outline"}
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(s);
                    }}
                  >
                    {isActive ? "Active" : "Select"}
                  </Button>
                </button>
              );
            })}
          </div>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>.mcp.json schema</CardTitle>
          <CardDescription className="hidden md:block">
            Same shape used by Claude Desktop / Claude Code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock language="application/json">{SCHEMA_EXAMPLE}</CodeBlock>
        </CardContent>
      </Card>
    </PageShell>
  );
}

const SCHEMA_EXAMPLE = `{
  "mcpServers": {
    "everything": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything", "stdio"],
      "env": { "DEBUG": "1" }
    },
    "remote": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": { "X-Foo": "bar" }
    }
  }
}`;
