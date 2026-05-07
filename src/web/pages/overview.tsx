import { useState } from "react";
import {
  AlertCircle,
  RefreshCw,
  Clock,
  Tag,
  Loader2,
  ChevronRight,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty } from "@/components/empty";
import { MetaItem, PageShell } from "@/components/page-shell";
import { StatusDot } from "@/components/status-dot";
import { TransportIcon, transportLabel } from "@/components/transport-icon";
import { useConnectionStore } from "@/stores/connection-store";
import { useActivityStore, type ActivityEntry } from "@/stores/activity-store";
import { CodeBlock } from "@/components/code-block";
import { cn, formatRelativeTime } from "@/lib/utils";

export function OverviewPage() {
  const { server, data, connectionState: state, error, lastDiscoveredAt, rediscover } =
    useConnectionStore();
  const activity = useActivityStore((s) => s.entries);
  const activityForServer = activity.filter((a) => a.serverName === server?.name);

  if (!server) {
    return null;
  }

  const tone =
    state === "connected"
      ? "success"
      : state === "error"
        ? "destructive"
        : state === "connecting"
          ? "warning"
          : "muted";
  const statusLabel = {
    connected: "Connected",
    connecting: "Connecting…",
    disconnected: "Disconnected",
    error: "Connection error",
    idle: "Idle",
  }[state];

  return (
    <PageShell
      title={
        <span className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => void rediscover()}
            disabled={state === "connecting"}
            className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
          >
            {state === "connecting" ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <RefreshCw className="size-5" />
            )}
          </button>
          {data?.server?.title ?? data?.server?.name ?? server!.name}
          <span className="font-mono text-base text-muted-foreground/70">·</span>
          <span className="font-mono text-base text-muted-foreground/80">
            {server!.name}
          </span>
        </span>
      }
      description={data?.server?.instructions ?? undefined}
      meta={
        <>
          <MetaItem>
            <span className="inline-flex items-center gap-1.5">
              <StatusDot
                tone={tone}
                pulse={state === "connected" || state === "connecting"}
              />
              <span className={tone === "success" ? "text-success" : ""}>
                {statusLabel}
              </span>
            </span>
          </MetaItem>
          <MetaItem>
            <Badge variant="muted" className="font-mono">
              <TransportIcon transport={server!.transport} />
              {transportLabel(server!.transport)}
            </Badge>
          </MetaItem>
          {data?.server?.version && (
            <MetaItem icon={Tag}>
              <span className="font-mono text-foreground/70">
                {data.server?.version}
              </span>
            </MetaItem>
          )}
          {lastDiscoveredAt && (
            <MetaItem icon={Clock}>
              discovered {formatRelativeTime(lastDiscoveredAt)}
            </MetaItem>
          )}
        </>
      }
    >
      {state === "error" && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-4 py-5">
            <AlertCircle className="size-5 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-base font-medium">Couldn't connect to this server</div>
              <div className="text-sm text-muted-foreground mt-1 break-all">
                {error}
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void rediscover()}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1">
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              Calls and reads recorded since the dashboard loaded.
            </CardDescription>
          </div>
          <Badge variant="muted" className="font-mono pt-1">
            {activityForServer.length}
          </Badge>
        </CardHeader>
        {activityForServer.length === 0 ? (
          <CardContent>
            <Empty
              title="Nothing yet"
              description="Call a tool, read a resource, or get a prompt — the request will show up here."
            />
          </CardContent>
        ) : (
          <div className="divide-y divide-border/60">
            {activityForServer.slice(0, 8).map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </Card>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const [open, setOpen] = useState(false);

  const kindLabel = {
    "tool-call": "tool",
    "resource-read": "resource",
    "prompt-get": "prompt",
    complete: "complete",
    discover: "discover",
    auth: "auth",
    disconnect: "disconnect",
  }[entry.kind];

  const tone =
    entry.outcome === "ok"
      ? "success"
      : entry.outcome === "error"
        ? "destructive"
        : "warning";

  const detail =
    entry.outcome === "error" && entry.error
      ? entry.error
      : entry.detail ?? "";

  const hasResponse = entry.response !== undefined;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-4 px-6 py-4",
          hasResponse && "cursor-pointer hover:bg-muted/40 transition-colors",
        )}
        onClick={hasResponse ? () => setOpen(!open) : undefined}
      >
        <ChevronRight
          className={cn(
            "size-4 shrink-0 transition-transform duration-150 text-muted-foreground",
            open && "rotate-90",
            !hasResponse && "invisible",
          )}
        />
        <StatusDot tone={tone} pulse={entry.outcome === "pending"} />
        <Badge variant={tone} className="font-mono w-24 pt-1 justify-center">
          {kindLabel}
        </Badge>
        <span className="font-mono text-sm truncate flex-1 min-w-0">
          {entry.target}
        </span>
        <span
          className={cn(
            "font-mono text-xs truncate hidden md:block max-w-md",
            entry.outcome === "error"
              ? "text-destructive/90"
              : "text-muted-foreground/80",
          )}
        >
          {detail}
        </span>
        {entry.tokenCount != null && (
          <span className="font-mono text-xs text-muted-foreground/80 tabular-nums w-24 text-right hidden lg:block">
            {entry.tokenCount.toLocaleString()} tok
          </span>
        )}
        <span className="font-mono text-xs text-muted-foreground/80 tabular-nums w-16 text-right">
          {entry.durationMs == null
            ? "…"
            : entry.durationMs >= 1000
              ? `${(entry.durationMs / 1000).toFixed(2)}s`
              : `${entry.durationMs}ms`}
        </span>
        <span className="text-xs text-muted-foreground/70 w-22 text-right">
          {formatRelativeTime(entry.at)}
        </span>
      </div>
      {open && hasResponse && (
        <div className="px-6 pb-4">
          <CodeBlock language="application/json" caption="Response">
            {JSON.stringify(entry.response, null, 2)}
          </CodeBlock>
        </div>
      )}
    </div>
  );
}
