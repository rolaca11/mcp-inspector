import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  FileBox,
  GitBranch,
  Hammer,
  Layers,
  Loader2,
  MessageSquare,
  Sparkles,
  Terminal,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CodeBlock } from "@/components/code-block";
import { Empty } from "@/components/empty";
import { MetaItem, PageShell } from "@/components/page-shell";
import { StatusDot } from "@/components/status-dot";
import { TransportIcon, transportLabel } from "@/components/transport-icon";
import { useServer } from "@/contexts/server-context";
import { useActivity } from "@/hooks/use-activity";
import type { ActivityEntry } from "@/data/activity";
import { cn, formatRelativeTime } from "@/lib/utils";

export function OverviewPage() {
  const navigate = useNavigate();
  const { serverName } = useParams<{ serverName: string }>();
  const goTo = (sub: string) =>
    navigate(`/${encodeURIComponent(serverName!)}/${sub}`);
  const { server, data, state, error, lastDiscoveredAt, rediscover } =
    useServer();
  const activity = useActivity();
  const activityForServer = activity.filter((a) => a.serverName === server.name);

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
          {data?.server?.title ?? data?.server?.name ?? server.name}
          <span className="font-mono text-base text-muted-foreground/70">·</span>
          <span className="font-mono text-base text-muted-foreground/80">
            {server.name}
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
          <MetaItem icon={GitBranch}>
            <Badge variant="muted" className="font-mono">
              <TransportIcon transport={server.transport} />
              {transportLabel(server.transport)}
            </Badge>
          </MetaItem>
          {data?.server?.version && (
            <MetaItem icon={Layers}>
              <span className="font-mono text-foreground/70">
                {data.server.name}@{data.server.version}
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
      actions={
        <>
          <Button variant="outline" size="sm" disabled>
            <Terminal className="size-3.5" />
            Open REPL
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void rediscover()}
            disabled={state === "connecting"}
          >
            {state === "connecting" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ArrowUpRight className="size-3.5" />
            )}
            Re-discover
          </Button>
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

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        <StatCard
          icon={FileBox}
          label="Resources"
          value={data?.resources.length ?? "—"}
          subtitle={
            data
              ? `+ ${data.resourceTemplates.length} template${
                  data.resourceTemplates.length === 1 ? "" : "s"
                }`
              : undefined
          }
          accent="info"
          loading={state === "connecting" && !data}
          onClick={() => goTo("resources")}
        />
        <StatCard
          icon={Hammer}
          label="Tools"
          value={data?.tools.length ?? "—"}
          subtitle={data && data.tools.length > 0 ? "ready to call" : undefined}
          accent="success"
          loading={state === "connecting" && !data}
          onClick={() => goTo("tools")}
        />
        <StatCard
          icon={MessageSquare}
          label="Prompts"
          value={data?.prompts.length ?? "—"}
          accent="warning"
          loading={state === "connecting" && !data}
          onClick={() => goTo("prompts")}
        />
        <StatCard
          icon={Sparkles}
          label="Completions"
          value={
            data
              ? data.capabilities.completions
                ? "yes"
                : "no"
              : "—"
          }
          subtitle="argument autocompletion"
          accent="default"
          loading={state === "connecting" && !data}
          onClick={() => goTo("completions")}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-col gap-1">
              <CardTitle>Server capabilities</CardTitle>
              <CardDescription>
                As advertised in the initialize handshake.
              </CardDescription>
            </div>
            {data ? (
              <Badge variant="success">
                <CheckCircle2 className="size-3" />
                Initialized
              </Badge>
            ) : (
              <Badge variant="muted">—</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {data ? (
              <CapabilityList capabilities={data.capabilities} />
            ) : state === "connecting" ? (
              <SkeletonRows />
            ) : (
              <Empty
                title="Not connected"
                description="Click Connect to initialize this server."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connection</CardTitle>
            <Badge variant="muted" className="font-mono">
              {transportLabel(server.transport)}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground/70 mb-2">
                Target
              </div>
              <CodeBlock copyable language={server.transport}>
                {server.target}
              </CodeBlock>
            </div>
            {server.env && Object.keys(server.env).length > 0 && (
              <KvList
                label="Environment"
                entries={Object.entries(server.env)}
                separator="="
              />
            )}
            {server.headers && Object.keys(server.headers).length > 0 && (
              <KvList
                label="Headers"
                entries={Object.entries(server.headers)}
                separator=":"
              />
            )}
            <Separator />
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground/70 mb-2">
                Loaded from
              </div>
              <div className="font-mono text-xs text-muted-foreground/90 truncate">
                {server.source}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1">
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              Calls and reads recorded since the dashboard loaded.
            </CardDescription>
          </div>
          <Badge variant="muted" className="font-mono">
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

interface StatCardProps {
  icon: typeof FileBox;
  label: string;
  value: number | string;
  subtitle?: string;
  accent?: "default" | "success" | "warning" | "info";
  loading?: boolean;
  onClick?: () => void;
}

function StatCard({
  icon: Icon,
  label,
  value,
  subtitle,
  accent = "default",
  loading,
  onClick,
}: StatCardProps) {
  const accentBg = {
    default: "bg-muted/40 text-foreground/80",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    info: "bg-info/10 text-info",
  }[accent];

  return (
    <button type="button" onClick={onClick} className="text-left">
      <Card className="transition-[border-color,background-color] hover:border-border hover:bg-card/70 cursor-pointer">
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
              {label}
            </span>
            <span
              className={cn(
                "grid place-items-center rounded-md p-2",
                accentBg,
              )}
            >
              <Icon className="size-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2.5">
            <span className="text-4xl font-semibold tracking-tight tabular-nums">
              {loading ? <span className="text-muted-foreground/50">…</span> : value}
            </span>
            {subtitle && !loading && (
              <span className="text-sm text-muted-foreground/80">
                {subtitle}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

function CapabilityList({
  capabilities,
}: {
  capabilities: Record<string, unknown>;
}) {
  const known = ["resources", "tools", "prompts", "completions", "logging"];
  const seen = new Set<string>();
  const rows: Array<{ name: string; enabled: boolean; meta: string }> = [];
  for (const key of known) {
    seen.add(key);
    const cap = capabilities[key];
    rows.push({
      name: key,
      enabled: cap != null,
      meta: describeCapability(key, cap),
    });
  }
  for (const [key, value] of Object.entries(capabilities)) {
    if (seen.has(key)) continue;
    rows.push({
      name: key,
      enabled: true,
      meta: describeCapability(key, value),
    });
  }
  return (
    <>
      {rows.map((row) => (
        <CapabilityRow key={row.name} {...row} />
      ))}
    </>
  );
}

function describeCapability(name: string, cap: unknown): string {
  if (cap == null) return "—";
  if (typeof cap !== "object") return String(cap);
  const flags: string[] = [];
  for (const [k, v] of Object.entries(cap as Record<string, unknown>)) {
    if (v === true) flags.push(k);
    else if (v && typeof v === "object") flags.push(k);
  }
  if (flags.length > 0) return flags.join(" · ");
  if (name === "completions" || name === "logging") return "supported";
  return "supported";
}

function CapabilityRow({
  name,
  enabled,
  meta,
}: {
  name: string;
  enabled: boolean;
  meta: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border/40 bg-card/30 px-4 py-3">
      <div className="flex items-center gap-3">
        <StatusDot tone={enabled ? "success" : "muted"} />
        <span className="font-mono text-sm">{name}</span>
      </div>
      <span className="text-sm text-muted-foreground/80">{meta}</span>
    </div>
  );
}

function KvList({
  label,
  entries,
  separator,
}: {
  label: string;
  entries: Array<[string, string]>;
  separator: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground/70 mb-2">
        {label}
      </div>
      <div className="space-y-1.5 font-mono text-sm">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-2">
            <span className="text-muted-foreground/70">
              {k}
              {separator}
            </span>
            <span className="text-foreground/80 break-all">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-md border border-border/40 bg-card/30 px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <span className="size-2.5 rounded-full bg-muted" />
            <span className="h-3.5 w-20 rounded bg-muted/60 animate-pulse" />
          </div>
          <span className="h-3.5 w-28 rounded bg-muted/40 animate-pulse" />
        </div>
      ))}
    </>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
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

  return (
    <div className="flex items-center gap-4 px-6 py-4">
      <StatusDot tone={tone} pulse={entry.outcome === "pending"} />
      <Badge variant="muted" className="font-mono w-[90px] justify-center">
        {kindLabel}
      </Badge>
      <span className="font-mono text-sm truncate flex-1 min-w-0">
        {entry.target}
      </span>
      <span
        className={cn(
          "font-mono text-xs truncate hidden md:block max-w-[28rem]",
          entry.outcome === "error"
            ? "text-destructive/90"
            : "text-muted-foreground/80",
        )}
      >
        {detail}
      </span>
      {entry.tokenCount != null && (
        <span className="font-mono text-xs text-muted-foreground/80 tabular-nums w-[6rem] text-right hidden lg:block">
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
  );
}
