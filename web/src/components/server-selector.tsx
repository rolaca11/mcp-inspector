import { Check, ChevronsUpDown, Plus } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusDot } from "@/components/status-dot";
import { TransportIcon, transportLabel } from "@/components/transport-icon";
import type { ConnectionState } from "@/contexts/server-context";
import { cn } from "@/lib/utils";
import type { MCPServer } from "@/data/types";

interface ServerSelectorProps {
  servers: MCPServer[];
  active: MCPServer;
  onSelect: (server: MCPServer) => void;
  /** Live connection state for the active server only. */
  activeConnection: ConnectionState;
  variant?: "primary" | "secondary";
}

const CONNECTION_TONE: Record<
  ConnectionState,
  "success" | "warning" | "destructive" | "muted"
> = {
  connected: "success",
  connecting: "warning",
  error: "destructive",
  disconnected: "muted",
  idle: "muted",
};

export function ServerSelector({
  servers,
  active,
  onSelect,
  activeConnection,
  variant = "primary",
}: ServerSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex h-8 items-center gap-2 rounded-md border border-border/60 px-2.5 text-sm transition-[background-color,border-color] cursor-pointer",
            variant === "primary"
              ? "bg-card/40 hover:bg-card/70"
              : "bg-transparent hover:bg-card/40",
          )}
        >
          <StatusDot
            tone={CONNECTION_TONE[activeConnection]}
            pulse={activeConnection === "connected" || activeConnection === "connecting"}
          />
          <TransportIcon
            transport={active.transport}
            className="text-muted-foreground"
          />
          <span className="font-medium leading-none">{active.name}</span>
          <ChevronsUpDown className="size-3 text-muted-foreground/70 group-hover:text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-[22rem]"
      >
        <DropdownMenuLabel>Named servers</DropdownMenuLabel>
        {servers.map((server) => {
          const isActive = server.name === active.name;
          return (
            <DropdownMenuItem
              key={server.name}
              onSelect={() => onSelect(server)}
              className="items-start py-2"
            >
              <StatusDot
                tone={
                  isActive
                    ? CONNECTION_TONE[activeConnection]
                    : "muted"
                }
                className="mt-1.5"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">
                    {server.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                    {transportLabel(server.transport)}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-muted-foreground/80 truncate">
                  {server.target}
                </div>
              </div>
              {isActive && <Check className="size-4 text-success" />}
            </DropdownMenuItem>
          );
        })}
        {servers.length === 0 && (
          <div className="px-2.5 py-3 text-xs text-muted-foreground">
            No servers configured.
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-muted-foreground">
          <Plus className="size-4" />
          Edit <span className="font-mono">.mcp.json</span>&hellip;
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
