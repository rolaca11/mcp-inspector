import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { create } from "zustand";
import {
  ExternalLink,
  Hammer,
  Hash,
  Plug,
  PlugZap,
  RefreshCw,
  Unplug,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { NAV_ITEMS } from "@/components/nav-tabs";
import { StatusDot } from "@/components/status-dot";
import { transportLabel } from "@/components/transport-icon";
import { useConnectionStore } from "@/stores/connection-store";
import { useSelectionStore } from "@/stores/selection-store";
import { toolUiResourceUri } from "@/lib/mcp-apps";
import type { MCPServer } from "@/data/types";

/* ------------------------------------------------------------------ */
/* Open-state store — lets any chrome element (command bar pill, status  */
/* bar, mobile button) trigger the single mounted palette.              */
/* ------------------------------------------------------------------ */

interface CommandMenuState {
  open: boolean;
  setOpen(open: boolean): void;
  toggle(): void;
}

export const useCommandMenu = create<CommandMenuState>((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set({ open: !get().open }),
}));

/* ------------------------------------------------------------------ */

interface CommandPaletteProps {
  servers: MCPServer[];
  active: MCPServer;
  onSelectServer: (server: MCPServer) => void;
}

/**
 * The signature ⌘K command palette, shared by both skins. Lets you jump to a
 * page, switch servers, deep-link into a specific tool/resource, and run quick
 * actions (refresh, disconnect, switch skin). Themed entirely through tokens,
 * so it adopts whichever skin is active.
 */
export function CommandPalette({
  servers,
  active,
  onSelectServer,
}: CommandPaletteProps) {
  const { open, setOpen } = useCommandMenu();
  const [search, setSearch] = React.useState("");
  const navigate = useNavigate();
  const location = useLocation();

  const { data, connectionState, rediscover, disconnect, pendingAuthUrl } =
    useConnectionStore();
  const selection = useSelectionStore();

  // Global ⌘K / Ctrl-K.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        useCommandMenu.getState().toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Clear the query whenever the palette (re)opens.
  React.useEffect(() => {
    if (open) setSearch("");
  }, [open]);

  const close = React.useCallback(() => setOpen(false), [setOpen]);

  const go = React.useCallback(
    (path: string) => {
      navigate(`/${encodeURIComponent(active.id)}/${path}`);
      close();
    },
    [navigate, active.id, close],
  );

  const openTool = React.useCallback(
    (name: string) => {
      selection.set(active.id, "tools", name);
      go("tools");
    },
    [selection, active.id, go],
  );

  const openResource = React.useCallback(
    (key: string) => {
      selection.set(active.id, "resources-selected", key);
      go("resources");
    },
    [selection, active.id, go],
  );

  const run = React.useCallback(
    (fn: () => void) => {
      fn();
      close();
    },
    [close],
  );

  const tools = data?.tools ?? [];
  const resources = data?.resources ?? [];
  const templates = data?.resourceTemplates ?? [];
  const currentSub =
    location.pathname.split("/").filter(Boolean)[1] ?? "overview";

  const counts: Record<string, number> = {
    resources: resources.length + templates.length,
    tools: tools.length,
    prompts: data?.prompts.length ?? 0,
    servers: servers.length,
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} label="Command palette">
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Jump to a page, server, tool, resource, or action…"
      />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        <CommandGroup heading="Go to">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const count = counts[item.key];
            return (
              <CommandItem
                key={item.key}
                value={`go ${item.label} ${item.path}`}
                onSelect={() => go(item.path)}
              >
                <Icon />
                <span>{item.label}</span>
                {typeof count === "number" && count > 0 && (
                  <span className="ml-1 font-mono text-[11px] tabular-nums text-muted-foreground/70">
                    {count}
                  </span>
                )}
                {currentSub === item.path && (
                  <CommandShortcut>current</CommandShortcut>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>

        {servers.length > 1 && (
          <CommandGroup heading="Switch server">
            {servers.map((server) => {
              const isActive = server.id === active.id;
              return (
                <CommandItem
                  key={server.id}
                  value={`server ${server.name} ${server.target} ${server.sourceLabel}`}
                  onSelect={() => run(() => onSelectServer(server))}
                >
                  <StatusDot
                    tone={
                      isActive
                        ? connectionState === "connected"
                          ? "success"
                          : connectionState === "connecting"
                            ? "warning"
                            : connectionState === "error"
                              ? "destructive"
                              : "muted"
                        : "muted"
                    }
                  />
                  <span>{server.name}</span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground/70">
                    {server.target}
                  </span>
                  <CommandShortcut>
                    {transportLabel(server.transport)}
                  </CommandShortcut>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {tools.length > 0 && (
          <CommandGroup heading="Tools">
            {tools.slice(0, 50).map((tool) => (
              <CommandItem
                key={tool.name}
                value={`tool ${tool.title ?? ""} ${tool.name} ${tool.description ?? ""}`}
                onSelect={() => openTool(tool.name)}
              >
                <Hammer />
                <span className="truncate">{tool.title ?? tool.name}</span>
                {tool.title && (
                  <span className="truncate font-mono text-[11px] text-muted-foreground/60">
                    {tool.name}
                  </span>
                )}
                {toolUiResourceUri(tool._meta) !== undefined && (
                  <CommandShortcut>app</CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {(resources.length > 0 || templates.length > 0) && (
          <CommandGroup heading="Resources">
            {resources.slice(0, 30).map((r) => (
              <CommandItem
                key={r.uri}
                value={`resource ${r.title ?? ""} ${r.name} ${r.uri}`}
                onSelect={() => openResource(r.uri)}
              >
                <Hash />
                <span className="truncate">{r.title ?? r.name}</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground/60">
                  {r.uri}
                </span>
              </CommandItem>
            ))}
            {templates.slice(0, 30).map((t) => (
              <CommandItem
                key={t.uriTemplate}
                value={`template ${t.title ?? ""} ${t.name} ${t.uriTemplate}`}
                onSelect={() => openResource(t.uriTemplate)}
              >
                <Hash />
                <span className="truncate">{t.title ?? t.name}</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground/60">
                  {t.uriTemplate}
                </span>
                <CommandShortcut>template</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem
            value="action refresh rediscover reconnect"
            onSelect={() => run(() => void rediscover())}
          >
            <RefreshCw />
            <span>Refresh · re-discover server</span>
            <CommandShortcut>⌘R</CommandShortcut>
          </CommandItem>
          {connectionState === "connected" ? (
            <CommandItem
              value="action disconnect"
              onSelect={() => run(() => void disconnect())}
            >
              <Unplug />
              <span>Disconnect</span>
            </CommandItem>
          ) : (
            <CommandItem
              value="action connect"
              onSelect={() => run(() => void rediscover())}
            >
              <Plug />
              <span>Connect</span>
            </CommandItem>
          )}
          {pendingAuthUrl && (
            <CommandItem
              value="action authorize oauth"
              onSelect={() =>
                run(() => window.open(pendingAuthUrl, "_blank", "noopener"))
              }
            >
              <ExternalLink />
              <span>Open authorization page</span>
            </CommandItem>
          )}
          <CommandItem
            value="action edit config mcp.json servers"
            onSelect={() => go("servers")}
          >
            <PlugZap />
            <span>Manage servers</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
