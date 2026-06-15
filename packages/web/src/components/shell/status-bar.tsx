import { useNavigate } from "react-router-dom";

import { StatusDot } from "@/components/status-dot";
import { TransportIcon, transportLabel } from "@/components/transport-icon";
import { useConnectionStore } from "@/stores/connection-store";
import { useActivityStore } from "@/stores/activity-store";
import { useServersStore } from "@/stores/servers-store";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  CONNECTION_LABEL,
  CONNECTION_TONE,
  computeCounts,
  displayTarget,
  formatDuration,
} from "@/components/shell/shell-helpers";

function Sep({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("h-3.5 w-px shrink-0 bg-border/70", className)}
    />
  );
}

/**
 * VS Code-style status bar pinned to the bottom. Surfaces live connection
 * state, transport/target, capability counts (clickable), and the most recent
 * activity echo (latency + tokens) — the strongest "this is an app, not a page"
 * signal.
 */
export function StatusBar() {
  const navigate = useNavigate();
  const { server, data, connectionState, lastDiscoveredAt, pendingAuthUrl } =
    useConnectionStore();
  const servers = useServersStore((s) => s.servers);
  const entries = useActivityStore((s) => s.entries);

  if (!server) return null;

  const counts = computeCounts(data, servers.length);
  const last = entries.find(
    (e) => e.serverName === server.id && e.outcome !== "pending",
  );
  const go = (path: string) =>
    navigate(`/${encodeURIComponent(server.id)}/${path}`);

  return (
    <footer className="z-20 flex h-7 shrink-0 select-none items-center gap-2.5 border-t border-border/60 bg-chrome px-3 font-mono text-[11px] tabular-nums text-muted-foreground">
      <span
        className={cn(
          "flex items-center gap-1.5",
          connectionState === "error" && "text-destructive",
        )}
      >
        <StatusDot
          tone={CONNECTION_TONE[connectionState]}
          pulse={
            connectionState === "connected" || connectionState === "connecting"
          }
        />
        <span>{CONNECTION_LABEL[connectionState]}</span>
      </span>

      <Sep />
      <span className="flex items-center gap-1.5">
        <TransportIcon transport={server.transport} />
        {transportLabel(server.transport)}
      </span>

      <Sep className="hidden sm:block" />
      <span className="hidden max-w-[15rem] truncate text-muted-foreground/80 sm:block">
        {displayTarget(server)}
      </span>

      <Sep className="hidden md:block" />
      <span className="hidden items-center gap-1.5 md:flex">
        <CountButton n={counts.tools ?? 0} label="tools" onClick={() => go("tools")} />
        <span className="text-muted-foreground/40">·</span>
        <CountButton n={counts.resources ?? 0} label="res" onClick={() => go("resources")} />
        <span className="text-muted-foreground/40">·</span>
        <CountButton n={counts.prompts ?? 0} label="prompts" onClick={() => go("prompts")} />
      </span>

      {last && (
        <>
          <Sep className="hidden lg:block" />
          <span className="hidden min-w-0 max-w-[26rem] items-center gap-1.5 lg:flex">
            <span className={last.outcome === "error" ? "text-destructive" : "text-primary/80"}>
              {last.outcome === "error" ? "✗" : "→"}
            </span>
            <span className="truncate text-foreground/75">{last.target}</span>
            {last.tokenCount != null && (
              <span className="shrink-0 text-muted-foreground/60">
                · {last.tokenCount.toLocaleString()}tok
              </span>
            )}
            {last.durationMs != null && (
              <span className="shrink-0 text-muted-foreground/60">
                · {formatDuration(last.durationMs)}
              </span>
            )}
          </span>
        </>
      )}

      <span className="ml-auto flex items-center gap-2.5">
        {pendingAuthUrl && (
          <>
            <span className="flex items-center gap-1.5 text-warning">
              <StatusDot tone="warning" pulse />
              auth
            </span>
            <Sep />
          </>
        )}
        {lastDiscoveredAt && (
          <span className="hidden text-muted-foreground/60 md:inline">
            synced {formatRelativeTime(lastDiscoveredAt)}
          </span>
        )}
        <span className="text-muted-foreground/50">v{__PKG_VERSION__}</span>
      </span>
    </footer>
  );
}

function CountButton({
  n,
  label,
  onClick,
}: {
  n: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer transition-colors hover:text-foreground"
    >
      <span className="text-foreground/80">{n}</span> {label}
    </button>
  );
}
