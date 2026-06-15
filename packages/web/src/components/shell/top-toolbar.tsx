import { Search, X } from "lucide-react";
import { useLocation } from "react-router-dom";

import { Logo } from "@/components/logo";
import { NAV_ITEMS } from "@/components/nav-tabs";
import { Kbd } from "@/components/ui/kbd";
import { ConnectButton } from "@/components/shell/connect-button";
import { useCommandMenu } from "@/components/command-palette";
import type { ConnectionState } from "@/stores/connection-store";

/**
 * Classic skin's content top-bar: the page breadcrumb on the left, and the
 * global cluster (⌘K, connect/refresh, window close) on the right. Never
 * scrolls.
 */
export function TopToolbar({
  connection,
  onConnect,
  onRediscover,
}: {
  connection: ConnectionState;
  onConnect: () => void;
  onRediscover: () => void;
}) {
  const location = useLocation();
  const sub = location.pathname.split("/").filter(Boolean)[1] ?? "overview";
  const pageLabel = NAV_ITEMS.find((i) => i.path === sub)?.label ?? "Overview";
  const openMenu = useCommandMenu((s) => s.setOpen);
  const isApp = typeof window !== "undefined" && window.location.protocol === "app:";

  return (
    <header className="z-20 flex h-12 shrink-0 items-center gap-3 border-b border-border/60 bg-chrome px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <Logo size={20} className="text-foreground lg:hidden" />
        <h1 className="truncate text-sm font-medium">{pageLabel}</h1>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => openMenu(true)}
          className="hidden h-8 w-64 cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-card/70 sm:flex lg:w-80 xl:w-96"
        >
          <Search className="size-3.5" />
          <span className="text-muted-foreground/80">Search…</span>
          <Kbd className="ml-auto gap-0.5 tracking-normal">
            <span className="leading-none">⌘</span>
            <span className="leading-none">K</span>
          </Kbd>
        </button>
        <button
          type="button"
          onClick={() => openMenu(true)}
          aria-label="Open command palette"
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:hidden"
        >
          <Search className="size-4" />
        </button>

        <ConnectButton
          state={connection}
          onConnect={onConnect}
          onRediscover={onRediscover}
        />

        {isApp && (
          <button
            type="button"
            onClick={() => window.close()}
            aria-label="Close window"
            className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </header>
  );
}
