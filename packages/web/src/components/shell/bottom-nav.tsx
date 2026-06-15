import { MoreHorizontal } from "lucide-react";
import { NavLink } from "react-router-dom";

import { NAV_ITEMS, type NavKey } from "@/components/nav-tabs";
import { useCommandMenu } from "@/components/command-palette";
import { cn } from "@/lib/utils";

const MOBILE_KEYS: NavKey[] = ["overview", "resources", "tools", "prompts"];

/**
 * Mobile primary navigation: a fixed bottom tab bar (the two desktop navs —
 * sidebar / icon rail — collapse to this below `lg`). The "More" cell opens the
 * ⌘K palette, which carries every remaining destination, server, and action.
 */
export function BottomNav({
  serverName,
  counts,
}: {
  serverName: string;
  counts: Partial<Record<NavKey, number>>;
}) {
  const openMenu = useCommandMenu((s) => s.setOpen);
  const prefix = `/${encodeURIComponent(serverName)}`;
  const items = NAV_ITEMS.filter((i) => MOBILE_KEYS.includes(i.key));

  return (
    <nav
      className="z-20 flex h-14 shrink-0 items-stretch border-t border-border/60 bg-chrome pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="Primary"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const count = counts[item.key];
        return (
          <NavLink
            key={item.key}
            to={`${prefix}/${item.path}`}
            className={({ isActive }) =>
              cn(
                "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] transition-colors",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-signature"
                  />
                )}
                <span className="relative">
                  <Icon className="size-[18px]" />
                  {typeof count === "number" && count > 0 && (
                    <span className="absolute -right-2 -top-1.5 font-mono text-[9px] tabular-nums text-signature">
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </span>
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        );
      })}
      <button
        type="button"
        onClick={() => openMenu(true)}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <MoreHorizontal className="size-[18px]" />
        <span>More</span>
      </button>
    </nav>
  );
}
