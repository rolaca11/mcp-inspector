import {
  Activity,
  FileBox,
  Hammer,
  KeyRound,
  MessageSquare,
  Server,
  Sparkles,
} from "lucide-react";

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
  count?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "Overview", icon: Activity },
  { key: "resources", label: "Resources", icon: FileBox },
  { key: "tools", label: "Tools", icon: Hammer },
  { key: "prompts", label: "Prompts", icon: MessageSquare },
  { key: "completions", label: "Completions", icon: Sparkles },
  { key: "auth", label: "Auth", icon: KeyRound },
  { key: "servers", label: "Servers", icon: Server },
];

interface NavTabsProps {
  active: NavKey;
  onChange: (key: NavKey) => void;
  counts?: Partial<Record<NavKey, number>>;
}

export function NavTabs({ active, onChange, counts }: NavTabsProps) {
  return (
    <div className="border-b border-border/60 bg-background/40">
      <div className="mx-auto flex max-w-[1400px] items-end gap-2 px-6">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.key === active;
          const count = counts?.[item.key];
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              className={cn(
                "group relative inline-flex items-center gap-2 px-4 py-3.5 text-sm font-medium transition-colors cursor-pointer",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground/80 hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "size-3.5 transition-colors",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground/60 group-hover:text-muted-foreground",
                )}
              />
              <span>{item.label}</span>
              {typeof count === "number" && (
                <span
                  className={cn(
                    "ml-0.5 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums leading-none font-mono",
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
            </button>
          );
        })}
      </div>
    </div>
  );
}
