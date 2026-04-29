import {
  Activity,
  FileBox,
  Hammer,
  KeyRound,
  MessageSquare,
  Server,
  Sparkles,
} from "lucide-react";
import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";

export type NavKey =
  | "overview"
  | "resources"
  | "tools"
  | "prompts"
  | "completions"
  | "auth"
  | "servers";

export interface NavItem {
  key: NavKey;
  label: string;
  icon: typeof Activity;
  /** Path segment under `/:serverName/`. */
  path: string;
  count?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "Overview", icon: Activity, path: "overview" },
  { key: "resources", label: "Resources", icon: FileBox, path: "resources" },
  { key: "tools", label: "Tools", icon: Hammer, path: "tools" },
  { key: "prompts", label: "Prompts", icon: MessageSquare, path: "prompts" },
  { key: "completions", label: "Completions", icon: Sparkles, path: "completions" },
  { key: "auth", label: "Auth", icon: KeyRound, path: "auth" },
  { key: "servers", label: "Servers", icon: Server, path: "servers" },
];

interface NavTabsProps {
  /** Active server's name; used to build per-server route URLs. */
  serverName: string;
  counts?: Partial<Record<NavKey, number>>;
}

export function NavTabs({ serverName, counts }: NavTabsProps) {
  const prefix = `/${encodeURIComponent(serverName)}`;

  return (
    <div className="border-b border-border/60 bg-background/40">
      <div className="mx-auto flex max-w-[1800px] items-end gap-3 px-8">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const count = counts?.[item.key];
          return (
            <NavLink
              key={item.key}
              to={`${prefix}/${item.path}`}
              className={({ isActive }) =>
                cn(
                  "group relative inline-flex items-center gap-2.5 px-5 py-4 text-base font-medium transition-colors cursor-pointer",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground/80 hover:text-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={cn(
                      "size-4 transition-colors",
                      isActive
                        ? "text-foreground"
                        : "text-muted-foreground/60 group-hover:text-muted-foreground",
                    )}
                  />
                  <span>{item.label}</span>
                  {typeof count === "number" && (
                    <span
                      className={cn(
                        "ml-1 rounded-md px-2 py-0.5 text-xs tabular-nums leading-none font-mono",
                        isActive
                          ? "bg-foreground/10 text-foreground"
                          : "bg-muted/50 text-muted-foreground/80",
                      )}
                    >
                      {count}
                    </span>
                  )}
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute -bottom-px left-2 right-2 h-px bg-foreground"
                    />
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}
