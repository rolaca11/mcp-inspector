import * as React from "react";
import {
  AlertCircle,
  Eye,
  FileText,
  Image as ImageIcon,
  Loader2,
  Search,
  Variable,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/code-block";
import { Empty } from "@/components/empty";
import { PageShell } from "@/components/page-shell";
import { useConnectionStore } from "@/stores/connection-store";
import { useToolArgsStore } from "@/stores/tool-args-store";
import { api, ApiError } from "@/data/api";
import {
  expandTemplate,
  extractTemplateVariables,
  type MCPResource,
  type MCPResourceTemplate,
  type ReadResourceResult,
  type ResourceContents,
} from "@/data/types";
import { cn } from "@/lib/utils";

export function ResourcesPage() {
  const { server, data, connectionState: state } = useConnectionStore();
  const [query, setQuery] = React.useState("");

  if (!server) return null;

  const resources = data?.resources ?? [];
  const templates = data?.resourceTemplates ?? [];

  if (!data && state === "connecting") {
    return <Loading />;
  }
  if (!data) {
    return <NotConnected />;
  }
  if (resources.length === 0 && templates.length === 0) {
    return (
      <PageShell title="Resources">
        <Empty
          icon={FileText}
          title="No resources advertised"
          description="This server's `initialize` response didn't include any resources or resource templates."
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Resources"
      description="Static resources and parameterized templates exposed by this MCP server."
      actions={
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by URI or name…"
            className="pl-8 w-72"
          />
        </div>
      }
    >
      <Tabs defaultValue={resources.length > 0 ? "static" : "templates"}>
        <TabsList>
          <TabsTrigger value="static">
            Static
            <Badge variant="muted" className="ml-1.5 font-mono">
              {resources.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="templates">
            Templates
            <Badge variant="muted" className="ml-1.5 font-mono">
              {templates.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="static" className="mt-6">
          <StaticResourcesPanel
            serverName={server!.name}
            resources={resources}
            query={query}
          />
        </TabsContent>

        <TabsContent value="templates" className="mt-6">
          <TemplatesPanel
            serverName={server!.name}
            templates={templates}
            query={query}
          />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Static                                                              */
/* ------------------------------------------------------------------ */

function StaticResourcesPanel({
  serverName,
  resources,
  query,
}: {
  serverName: string;
  resources: MCPResource[];
  query: string;
}) {
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return resources;
    return resources.filter(
      (r) =>
        r.uri.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.title?.toLowerCase().includes(q),
    );
  }, [query, resources]);

  const [selected, setSelected] = React.useState<MCPResource | null>(
    resources[0] ?? null,
  );

  React.useEffect(() => {
    if (!selected || !resources.find((r) => r.uri === selected.uri)) {
      setSelected(resources[0] ?? null);
    }
  }, [resources, selected]);

  if (resources.length === 0) {
    return (
      <Empty
        icon={FileText}
        title="No static resources"
        description="This server only exposes templated resources. Switch to the Templates tab."
      />
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <Card className="overflow-hidden lg:sticky lg:top-20 self-start max-h-[calc(100vh-7rem)] flex flex-col">
        <CardHeader>
          <CardTitle>Static resources</CardTitle>
          <Badge variant="muted" className="font-mono">
            {filtered.length}
          </Badge>
        </CardHeader>
        <div className="divide-y divide-border/50 overflow-y-auto min-h-0">
          {filtered.map((r) => (
            <ResourceListRow
              key={r.uri}
              resource={r}
              isActive={r.uri === selected?.uri}
              onSelect={() => setSelected(r)}
            />
          ))}
          {filtered.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              No resources match "{query}".
            </div>
          )}
        </div>
      </Card>

      {selected && <ResourcePreview key={selected.uri} serverName={serverName} resource={selected} />}
    </div>
  );
}

function ResourceListRow({
  resource,
  isActive,
  onSelect,
}: {
  resource: MCPResource;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-4 px-6 py-4 text-left transition-colors cursor-pointer",
        isActive ? "bg-accent/40" : "hover:bg-accent/20",
      )}
    >
      <ResourceIcon mimeType={resource.mimeType} className="mt-1" />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-base">
          {resource.title ?? resource.name}
        </div>
        <div className="font-mono text-xs text-muted-foreground/90 truncate mt-0.5">
          {resource.uri}
        </div>
        {resource.description && (
          <div className="text-sm text-muted-foreground line-clamp-2 mt-1">
            {resource.description}
          </div>
        )}
      </div>
    </button>
  );
}

function ResourcePreview({
  serverName,
  resource,
}: {
  serverName: string;
  resource: MCPResource;
}) {
  const [result, setResult] = React.useState<ReadResourceResult | null>(null);
  const [reading, setReading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [readAt, setReadAt] = React.useState<number | null>(null);

  React.useEffect(() => {
    setResult(null);
    setError(null);
    setReadAt(null);
  }, [resource.uri]);

  const onRead = React.useCallback(async () => {
    setReading(true);
    setError(null);
    try {
      const t0 = performance.now();
      const r = await api.readResource(serverName, { uri: resource.uri });
      setResult(r);
      setReadAt(Math.round(performance.now() - t0));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setReading(false);
    }
  }, [serverName, resource.uri]);

  return (
    <div className="space-y-5 min-w-0">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1.5 min-w-0">
            <CardTitle className="flex items-center gap-2.5 flex-wrap">
              <span className="font-mono">{resource.title ?? resource.name}</span>
              {resource.mimeType && (
                <Badge variant="muted" className="font-mono">
                  {resource.mimeType}
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="font-mono truncate">
              {resource.uri}
            </CardDescription>
          </div>
          <Button variant="success" size="sm" onClick={onRead} disabled={reading}>
            {reading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Eye className="size-3.5" />
            )}
            Read
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {resource.description && (
            <p className="text-sm text-muted-foreground">{resource.description}</p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <KV label="MIME">
              <span className="font-mono">{resource.mimeType ?? "—"}</span>
            </KV>
            <KV label="Size">
              <span className="font-mono tabular-nums">
                {resource.size != null ? formatBytes(resource.size) : "—"}
              </span>
            </KV>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contents</CardTitle>
          {reading ? (
            <Badge variant="muted">
              <Loader2 className="size-3 animate-spin" />
              reading…
            </Badge>
          ) : error ? (
            <Badge variant="destructive">
              <AlertCircle className="size-3" />
              error
            </Badge>
          ) : result ? (
            <Badge variant="success">
              {result.contents.length} item{result.contents.length === 1 ? "" : "s"}
              {readAt != null && ` · ${readAt}ms`}
              {result._tokenCount != null && ` · ${result._tokenCount.toLocaleString()} tokens`}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent>
          {error ? (
            <ErrorRow message={error} />
          ) : result ? (
            <ResourceContentsView contents={result.contents} readAt={null} tokenCount={null} />
          ) : (
            <div className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
              Click <span className="font-medium text-foreground">Read</span> to
              fetch this resource through the server.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

function TemplatesPanel({
  serverName,
  templates,
  query,
}: {
  serverName: string;
  templates: MCPResourceTemplate[];
  query: string;
}) {
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.uriTemplate.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.title?.toLowerCase().includes(q),
    );
  }, [query, templates]);

  const [selected, setSelected] = React.useState<MCPResourceTemplate | null>(
    templates[0] ?? null,
  );

  React.useEffect(() => {
    if (!selected || !templates.find((t) => t.uriTemplate === selected.uriTemplate)) {
      setSelected(templates[0] ?? null);
    }
  }, [templates, selected]);

  if (templates.length === 0) {
    return (
      <Empty
        icon={Variable}
        title="No resource templates"
        description="This server doesn't expose any URI-template resources."
      />
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <Card className="overflow-hidden lg:sticky lg:top-20 self-start max-h-[calc(100vh-7rem)] flex flex-col">
        <CardHeader>
          <CardTitle>Resource templates</CardTitle>
          <Badge variant="muted" className="font-mono">
            {filtered.length}
          </Badge>
        </CardHeader>
        <div className="divide-y divide-border/50 overflow-y-auto min-h-0">
          {filtered.map((t) => (
            <TemplateListRow
              key={t.uriTemplate}
              template={t}
              isActive={t.uriTemplate === selected?.uriTemplate}
              onSelect={() => setSelected(t)}
            />
          ))}
          {filtered.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              No templates match "{query}".
            </div>
          )}
        </div>
      </Card>

      {selected && <TemplatePreview key={selected.uriTemplate} serverName={serverName} template={selected} />}
    </div>
  );
}

function TemplateListRow({
  template,
  isActive,
  onSelect,
}: {
  template: MCPResourceTemplate;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-4 px-6 py-4 text-left transition-colors cursor-pointer",
        isActive ? "bg-accent/40" : "hover:bg-accent/20",
      )}
    >
      <Variable className="size-4 text-muted-foreground mt-1" />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-base">
          {template.title ?? template.name}
        </div>
        <div className="font-mono text-xs text-muted-foreground/90 truncate mt-0.5">
          {template.uriTemplate}
        </div>
        {template.description && (
          <div className="text-sm text-muted-foreground line-clamp-2 mt-1">
            {template.description}
          </div>
        )}
      </div>
    </button>
  );
}

function TemplatePreview({
  serverName,
  template,
}: {
  serverName: string;
  template: MCPResourceTemplate;
}) {
  const variables = React.useMemo(
    () => extractTemplateVariables(template.uriTemplate),
    [template.uriTemplate],
  );

  // Persist template variable values in Zustand so they survive navigation.
  const { getArgs, setArg } = useToolArgsStore();
  const values = getArgs(serverName, template.uriTemplate) ?? {};

  const [result, setResult] = React.useState<ReadResourceResult | null>(null);
  const [reading, setReading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [readAt, setReadAt] = React.useState<number | null>(null);

  React.useEffect(() => {
    setResult(null);
    setError(null);
    setReadAt(null);
  }, [template.uriTemplate]);

  const expanded = expandTemplate(template.uriTemplate, values);
  const fullyExpanded = !/\{[^}]+\}/.test(expanded);

  const onRead = React.useCallback(async () => {
    if (!fullyExpanded) return;
    setReading(true);
    setError(null);
    try {
      const t0 = performance.now();
      const r = await api.readResource(serverName, { uri: expanded });
      setResult(r);
      setReadAt(Math.round(performance.now() - t0));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setReading(false);
    }
  }, [serverName, expanded, fullyExpanded]);

  return (
    <div className="space-y-5 min-w-0">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1.5 min-w-0">
            <CardTitle className="flex items-center gap-2.5 flex-wrap">
              <span className="font-mono">{template.title ?? template.name}</span>
              {template.mimeType && (
                <Badge variant="muted" className="font-mono">
                  {template.mimeType}
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="font-mono truncate">
              {template.uriTemplate}
            </CardDescription>
          </div>
          <Button
            variant="success"
            size="sm"
            onClick={onRead}
            disabled={!fullyExpanded || reading}
          >
            {reading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Eye className="size-3.5" />
            )}
            Resolve &amp; read
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {template.description && (
            <p className="text-sm text-muted-foreground">{template.description}</p>
          )}
          {variables.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 px-5 py-8 text-center text-sm text-muted-foreground">
              This template has no variables to fill.
            </div>
          ) : (
            <div className="space-y-5">
              {variables.map((v) => (
                <div key={v} className="space-y-2">
                  <Label className="flex items-center gap-2.5">
                    <span className="font-mono normal-case text-foreground">
                      {`{${v}}`}
                    </span>
                    <Badge variant="muted" className="font-mono">
                      string
                    </Badge>
                  </Label>
                  <Input
                    value={values[v] ?? ""}
                    onChange={(e) =>
                      setArg(serverName, template.uriTemplate, v, e.target.value)
                    }
                    className="font-mono"
                    placeholder="value"
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Resolved URI</CardTitle>
            <CardDescription className="hidden md:block">
              Expanded from template variables
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock copyable={fullyExpanded} language="uri">
              {expanded}
            </CodeBlock>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contents</CardTitle>
            {reading ? (
              <Badge variant="muted">
                <Loader2 className="size-3 animate-spin" />
                reading…
              </Badge>
            ) : error ? (
              <Badge variant="destructive">
                <AlertCircle className="size-3" />
                error
              </Badge>
            ) : result ? (
              <Badge variant="success">
                {result.contents.length} item{result.contents.length === 1 ? "" : "s"}
                {readAt != null && ` · ${readAt}ms`}
                {result._tokenCount != null && ` · ${result._tokenCount.toLocaleString()} tokens`}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent>
            {error ? (
              <ErrorRow message={error} />
            ) : result ? (
              <ResourceContentsView contents={result.contents} readAt={null} tokenCount={null} />
            ) : (
              <div className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                {fullyExpanded ? (
                  <>Click <span className="font-medium text-foreground">Resolve &amp; read</span> to fetch this resource.</>
                ) : (
                  <>Fill in the variables above to resolve the template.</>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

function ResourceContentsView({
  contents,
  readAt,
  tokenCount,
}: {
  contents: ResourceContents[];
  readAt: number | null;
  tokenCount?: number | null;
}) {
  if (contents.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
        Server returned no contents.
      </div>
    );
  }
  const captionParts: string[] = [];
  if (readAt != null) captionParts.push(`read in ${readAt}ms`);
  if (tokenCount != null) captionParts.push(`${tokenCount.toLocaleString()} tokens`);
  const caption = captionParts.length > 0 ? captionParts.join(" · ") : undefined;
  return (
    <div className="space-y-3">
      {contents.map((c, i) => (
        <ResourceContentBlock key={i} content={c} caption={
          i === 0 ? caption : undefined
        } />
      ))}
    </div>
  );
}

function ResourceContentBlock({
  content,
  caption,
}: {
  content: ResourceContents;
  caption?: string;
}) {
  const meta = `${content.mimeType ?? "?"}${
    caption ? ` · ${caption}` : ""
  }`;
  if (content.text != null) {
    const formatted = tryFormatJson(content.text, content.mimeType);
    return (
      <CodeBlock language={content.mimeType ?? "text/plain"} caption={meta}>
        {formatted}
      </CodeBlock>
    );
  }
  if (content.blob != null) {
    return (
      <div className="rounded-md border border-border/60 bg-card/40 px-3 py-3 text-xs text-muted-foreground">
        <div className="font-mono mb-2">{meta}</div>
        Binary blob · {formatBytes(approxDecodedLength(content.blob))} (base64)
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-3 py-3 text-xs text-muted-foreground">
      Unknown content shape
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
      <AlertCircle className="size-4 mt-0.5 text-destructive shrink-0" />
      <span className="break-all">{message}</span>
    </div>
  );
}

function ResourceIcon({
  mimeType,
  className,
}: {
  mimeType?: string;
  className?: string;
}) {
  const Icon = !mimeType
    ? FileText
    : mimeType.startsWith("image/")
      ? ImageIcon
      : FileText;
  return <Icon className={cn("size-4 text-muted-foreground", className)} />;
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/50 bg-card/40 px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground/70 mb-1.5">
        {label}
      </div>
      <div className="text-base">{children}</div>
    </div>
  );
}

function Loading() {
  return (
    <PageShell title="Resources">
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </PageShell>
  );
}

function NotConnected() {
  const { rediscover, connectionState: state } = useConnectionStore();
  return (
    <PageShell title="Resources">
      <Empty
        title="Not connected"
        description="Connect to this server to see its resources."
        actionLabel={state === "connecting" ? undefined : "Connect"}
        onAction={() => void rediscover()}
      />
    </PageShell>
  );
}

function SkeletonCard() {
  return (
    <Card>
      <CardContent className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-md border border-border/40 bg-card/30 px-3 py-2"
          >
            <span className="h-3 w-3 rounded-full bg-muted/50 animate-pulse" />
            <span className="h-3 w-32 rounded bg-muted/50 animate-pulse" />
            <span className="h-3 flex-1 rounded bg-muted/30 animate-pulse" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function tryFormatJson(text: string, mimeType?: string): string {
  const isJson =
    mimeType === "application/json" ||
    mimeType?.endsWith("+json") ||
    (!mimeType && (text.trimStart().startsWith("{") || text.trimStart().startsWith("[")));
  if (!isJson) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function formatBytes(n?: number): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function approxDecodedLength(b64: string): number {
  // base64 expands by 4/3, so decoded length ≈ length * 3/4 minus padding.
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}
