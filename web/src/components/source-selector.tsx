import { Check, ChevronsUpDown, FolderTree } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ConfigSource {
  /** absolute path */
  path: string;
  serverCount: number;
  origin: "home" | "cwd";
}

interface SourceSelectorProps {
  sources: ConfigSource[];
  activePath: string;
  onSelect: (path: string) => void;
}

export function SourceSelector({
  sources,
  activePath,
  onSelect,
}: SourceSelectorProps) {
  const active = sources.find((s) => s.path === activePath) ?? sources[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group inline-flex h-8 items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2.5 text-sm transition-[background-color] cursor-pointer hover:bg-card/70"
        >
          <FolderTree className="size-3.5 text-muted-foreground" />
          <span className="font-medium leading-none">
            {active?.origin === "home" ? "~/.mcp.json" : "project"}
          </span>
          <ChevronsUpDown className="size-3 text-muted-foreground/70 group-hover:text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[26rem]">
        <DropdownMenuLabel>Configuration sources</DropdownMenuLabel>
        {sources.map((source) => {
          const isActive = source.path === active?.path;
          return (
            <DropdownMenuItem
              key={source.path}
              onSelect={() => onSelect(source.path)}
              className="items-start py-2"
            >
              <FolderTree className="size-4 mt-0.5 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">
                    {source.origin === "home" ? "User-global" : "Project-local"}
                  </span>
                  <span className="text-[10px] text-muted-foreground/80">
                    {source.serverCount} server{source.serverCount === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-muted-foreground/80 truncate">
                  {source.path}
                </div>
              </div>
              {isActive && <Check className="size-4 text-success" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
