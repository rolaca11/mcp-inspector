import {
  ExternalLink,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

import { Logo } from "@/components/logo";
import { NAV_ITEMS, type NavItem, type NavKey } from "@/components/nav-tabs";
import { ServerSelector } from "@/components/server-selector";
import { SourceSelector } from "@/components/source-selector";
import { useSources } from "@/components/shell/shell-helpers";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ConnectionState } from "@/stores/connection-store";
import type { MCPServer } from "@/data/types";
import { cn } from "@/lib/utils";

const byKey = (key: NavKey) => NAV_ITEMS.find((i) => i.key === key)!;
const GROUPS: { label: string | null; keys: NavKey[] }[] = [
  { label: null, keys: ["overview"] },
  { label: "Capabilities", keys: ["resources", "tools", "prompts", "completions"] },
  { label: "Workspace", keys: ["auth", "servers"] },
];

interface AppSidebarProps {
  servers: MCPServer[];
  active: MCPServer;
  onSelect: (server: MCPServer) => void;
  connection: ConnectionState;
  counts: Partial<Record<NavKey, number>>;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/**
 * Classic skin's primary navigation: a full-height left sidebar with the brand,
 * the source/server switchers stacked, grouped vertical nav with capability
 * counts, and a footer mini-zone (skin switch · version · changelog). Collapses
 * to an icon rail.
 */
export function AppSidebar({
  servers,
  active,
  onSelect,
  connection,
  counts,
  collapsed,
  onToggleCollapse,
}: AppSidebarProps) {
  const { sources, sourceServers, handleSourceSelect } = useSources(
    servers,
    active,
    onSelect,
  );

  return (
    <aside className="flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Brand row — aligned to toolbar height across the divider */}
      <div
        className={cn(
          "flex h-12 shrink-0 items-center border-b border-sidebar-border",
          collapsed ? "justify-center px-0" : "gap-2.5 px-3",
        )}
      >
        <Logo size={24} className="text-foreground" />
        {!collapsed && (
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="font-mono text-sm font-semibold tracking-tight">
              mcp
            </span>
            <span className="font-mono text-sm text-muted-foreground">
              inspector
            </span>
          </div>
        )}
        {!collapsed && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            className="ml-auto inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>

      {/* Switchers */}
      {!collapsed && (
        <div className="flex flex-col gap-1.5 border-b border-sidebar-border px-2 py-2">
          <SourceSelector
            sources={sources}
            activePath={active.source}
            onSelect={handleSourceSelect}
            triggerClassName="w-full"
          />
          <ServerSelector
            servers={sourceServers}
            active={active}
            onSelect={onSelect}
            activeConnection={connection}
            triggerClassName="w-full"
          />
        </div>
      )}
      {collapsed && (
        <div className="flex justify-center border-b border-sidebar-border py-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        </div>
      )}

      {/* Nav */}
      <nav
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-2",
          collapsed ? "no-scrollbar px-0" : "px-2",
        )}
      >
        {GROUPS.map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-3")}>
            {group.label && !collapsed && (
              <div className="px-2.5 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/55">
                {group.label}
              </div>
            )}
            {group.label && collapsed && gi > 0 && (
              <div className="mx-auto mb-2 h-px w-6 bg-sidebar-border" />
            )}
            <div className="flex flex-col gap-0.5">
              {group.keys.map((key) => (
                <NavRow
                  key={key}
                  item={byKey(key)}
                  serverName={active.id}
                  count={counts[key]}
                  collapsed={collapsed}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer mini-zone */}
      {!collapsed && (
        <div className="mt-auto shrink-0 border-t border-sidebar-border px-3 py-2.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground/70">
            <span className="font-mono">v{__PKG_VERSION__}</span>
            <div className="flex items-center gap-2.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-default text-muted-foreground/60">
                    <Info className="size-3.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Built on @modelcontextprotocol/sdk
                </TooltipContent>
              </Tooltip>
              <a
                href={`https://github.com/rolaca11/mcp-inspector/releases/tag/v${__PKG_VERSION__}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
              >
                <ExternalLink className="size-3" />
                Changelog
              </a>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function NavRow({
  item,
  serverName,
  count,
  collapsed,
}: {
  item: NavItem;
  serverName: string;
  count?: number;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  const { pathname } = useLocation();
  const to = `/${encodeURIComponent(serverName)}/${item.path}`;
  // Compute active ourselves so `className` can be a STRING. NavLink's function
  // className stringifies when this link is a Radix Slot child (the collapsed
  // tooltip trigger), which would dump the function source into `class`.
  const isActive = pathname === to || pathname.startsWith(`${to}/`);

  const link = (
    <NavLink
      to={to}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative flex items-center rounded-md text-sm transition-colors",
        collapsed ? "mx-auto h-9 w-9 justify-center" : "h-8 gap-2.5 px-2.5",
        isActive
          ? "bg-sidebar-accent text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && typeof count === "number" && count > 0 && (
        <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded bg-muted/50 px-1 font-mono text-[10px] tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
    </NavLink>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">
        {item.label}
        {typeof count === "number" && count > 0 ? ` · ${count}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}
