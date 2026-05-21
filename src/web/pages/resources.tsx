import * as React from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Eye,
  FileText,
  Loader2,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Controller } from "react-hook-form";

import { CodeBlock } from "@/components/code-block";
import { ErrorMessage } from "@/components/error-message";
import { CompletableInput } from "@/components/completable-input";
import { Empty } from "@/components/empty";
import { PageShell } from "@/components/page-shell";
import { useConnectionStore } from "@/stores/connection-store";
import { useResultStore } from "@/stores/result-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useSyncedForm } from "@/hooks/use-synced-form";
import { templateVariablesToZod } from "@/lib/schema-builder";
import { api, ApiError } from "@/data/api";
import {
  expandTemplate,
  extractTemplateVariables,
  type ActivityResult,
  type MCPResource,
  type MCPResourceTemplate,
  type ReadResourceResult,
  type ResourceContents,
} from "@/data/types";
import { cn } from "@/lib/utils";
import { MarkdownDescription } from "@/components/markdown-description";

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
      <CombinedResourcesPanel
        serverName={server!.id}
        resources={resources}
        templates={templates}
        query={query}
      />
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Combined resources + templates                                      */
/* ------------------------------------------------------------------ */

type ListItem =
  | { kind: "static"; resource: MCPResource }
  | { kind: "template"; template: MCPResourceTemplate };

function itemKey(item: ListItem) {
  return item.kind === "static" ? item.resource.uri : item.template.uriTemplate;
}

function itemLabel(item: ListItem) {
  if (item.kind === "static") return item.resource.title ?? item.resource.name;
  return item.template.title ?? item.template.name;
}

function CombinedResourcesPanel({
  serverName,
  resources,
  templates,
  query,
}: {
  serverName: string;
  resources: MCPResource[];
  templates: MCPResourceTemplate[];
  query: string;
}) {
  const selectionStore = useSelectionStore();

  const items = React.useMemo<ListItem[]>(() => {
    const q = query.trim().toLowerCase();
    const statics: ListItem[] = resources
      .filter(
        (r) =>
          !q ||
          r.uri.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.title?.toLowerCase().includes(q),
      )
      .map((resource) => ({ kind: "static", resource }));
    const tmpls: ListItem[] = templates
      .filter(
        (t) =>
          !q ||
          t.uriTemplate.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.title?.toLowerCase().includes(q),
      )
      .map((template) => ({ kind: "template", template }));
    return [...statics, ...tmpls];
  }, [query, resources, templates]);

  const storedKey = selectionStore.get(serverName, "resources-selected");
  const selected = (storedKey ? items.find((i) => itemKey(i) === storedKey) : undefined) ?? items[0] ?? null;

  const setSelected = React.useCallback(
    (item: ListItem) => {
      selectionStore.set(serverName, "resources-selected", itemKey(item));
    },
    [serverName, selectionStore],
  );

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-32 self-start flex flex-col">
        <div className="overflow-y-auto min-h-0 flex flex-col gap-1 px-1">
          {items.map((item) => (
            <button
              key={itemKey(item)}
              type="button"
              onClick={() => setSelected(item)}
              className={cn(
                "w-full rounded-md px-4 py-2 text-left text-sm transition-colors cursor-pointer truncate",
                itemKey(item) === (selected ? itemKey(selected) : null)
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {itemLabel(item)}
            </button>
          ))}
          {items.length === 0 && (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">
              No resources match "{query}".
            </div>
          )}
        </div>
      </div>

      {selected?.kind === "static" && (
        <ResourcePreview key={selected.resource.uri} serverName={serverName} resource={selected.resource} />
      )}
      {selected?.kind === "template" && (
        <TemplatePreview key={selected.template.uriTemplate} serverName={serverName} template={selected.template} />
      )}
    </div>
  );
}

interface ReadState {
  activity?: ActivityResult<ReadResourceResult>;
  error?: string;
  errorResponse?: Record<string, unknown>;
}

function ResourcePreview({
  serverName,
  resource,
}: {
  serverName: string;
  resource: MCPResource;
}) {
  const resultStore = useResultStore();
  const [reading, setReading] = React.useState(false);

  const cached = resultStore.get<ReadState>(serverName, "resource", resource.uri);
  const activity = cached?.activity ?? null;
  const result = activity?.outcome === "ok" ? activity.result ?? null : null;
  const activityError = activity?.outcome === "error" ? activity.error ?? null : null;
  const error = cached?.error ?? activityError;
  const errorResponse = cached?.errorResponse;

  const onRead = React.useCallback(async () => {
    setReading(true);
    try {
      const activities = await api.readResource(serverName, { uri: resource.uri });
      resultStore.set(serverName, "resource", resource.uri, {
        activity: activities[0],
      } satisfies ReadState);
    } catch (e) {
      resultStore.set(serverName, "resource", resource.uri, {
        error: e instanceof ApiError ? e.message : (e as Error).message,
        errorResponse: e instanceof ApiError ? e.responseBody : undefined,
      } satisfies ReadState);
    } finally {
      setReading(false);
    }
  }, [serverName, resource.uri, resultStore]);

  return (
    <div className="space-y-5 min-w-0">
      <Card>
        <CardHeader>
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
        </CardHeader>
        <CardContent className="space-y-6">
          {resource.description && (
            <MarkdownDescription className="text-muted-foreground">{resource.description}</MarkdownDescription>
          )}
          <Button variant="success" onClick={onRead} disabled={reading}>
            {reading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Eye className="size-4" />
            )}
            Read
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contents</CardTitle>
          <CardAction>
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
                {activity?.durationMs != null && ` · ${activity.durationMs}ms`}
                {activity?.tokenCount != null && ` · ${activity.tokenCount.toLocaleString()} tokens`}
              </Badge>
            ) : null}
          </CardAction>
        </CardHeader>
        <CardContent>
          {error ? (
            <ErrorMessage error={error} errorResponse={errorResponse} />
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

  const schema = React.useMemo(
    () => templateVariablesToZod(variables),
    [variables],
  );

  const form = useSyncedForm({
    serverName,
    formKey: template.uriTemplate,
    schema,
    defaults: {},
  });

  const resultStore = useResultStore();
  const [reading, setReading] = React.useState(false);

  const cached = resultStore.get<ReadState>(serverName, "template", template.uriTemplate);
  const activity = cached?.activity ?? null;
  const result = activity?.outcome === "ok" ? activity.result ?? null : null;
  const activityError = activity?.outcome === "error" ? activity.error ?? null : null;
  const error = cached?.error ?? activityError;
  const errorResponse = cached?.errorResponse;

  const watchedValues = form.watch() as Record<string, string>;
  const expanded = expandTemplate(template.uriTemplate, watchedValues);
  const fullyExpanded = !/\{[^}]+\}/.test(expanded);

  const onRead = React.useCallback(async () => {
    if (!fullyExpanded) return;
    setReading(true);
    try {
      const activities = await api.readResource(serverName, { uri: expanded });
      resultStore.set(serverName, "template", template.uriTemplate, {
        activity: activities[0],
      } satisfies ReadState);
    } catch (e) {
      resultStore.set(serverName, "template", template.uriTemplate, {
        error: e instanceof ApiError ? e.message : (e as Error).message,
        errorResponse: e instanceof ApiError ? e.responseBody : undefined,
      } satisfies ReadState);
    } finally {
      setReading(false);
    }
  }, [serverName, expanded, fullyExpanded, resultStore, template.uriTemplate]);

  return (
    <div className="space-y-5 min-w-0">
      <Card>
        <CardHeader>
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
        </CardHeader>
        <CardContent className="space-y-6">
          {template.description && (
            <MarkdownDescription className="text-muted-foreground">{template.description}</MarkdownDescription>
          )}
          {variables.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 px-5 py-8 text-center text-sm text-muted-foreground">
              This template has no variables to fill.
            </div>
          ) : (
            <div className="space-y-5">
              {variables.map((v) => (
                <Controller
                  key={v}
                  name={v}
                  control={form.control}
                  render={({ field }) => {
                    const context: Record<string, string> = {};
                    for (const other of variables) {
                      if (other !== v && watchedValues[other]) context[other] = watchedValues[other];
                    }
                    return (
                      <div className="flex flex-col gap-2">
                        <Label className="flex items-center gap-2.5">
                          <span className="font-mono normal-case text-foreground">
                            {`{${v}}`}
                          </span>
                          <Badge variant="muted" className="font-mono">
                            string
                          </Badge>
                        </Label>
                        <CompletableInput
                          serverName={serverName}
                          refType="resource"
                          ref={template.uriTemplate}
                          argument={v}
                          value={(field.value as string) ?? ""}
                          onChange={field.onChange}
                          context={context}
                          placeholder="value"
                        />
                      </div>
                    );
                  }}
                />
              ))}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              variant="success"
              onClick={onRead}
              disabled={!fullyExpanded || reading}
            >
              {reading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Eye className="size-4" />
              )}
              Resolve &amp; read
            </Button>
            <code className="min-w-0 truncate text-sm font-mono text-muted-foreground">
              {expanded}
            </code>
            {fullyExpanded && <CopyUriButton text={expanded} />}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contents</CardTitle>
          <CardAction>
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
                {activity?.durationMs != null && ` · ${activity.durationMs}ms`}
                {activity?.tokenCount != null && ` · ${activity.tokenCount.toLocaleString()} tokens`}
              </Badge>
            ) : null}
          </CardAction>
        </CardHeader>
        <CardContent>
          {error ? (
            <ErrorMessage error={error} errorResponse={errorResponse} />
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
  );
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

function CopyUriButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground cursor-pointer"
      aria-label="Copy URI"
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}

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
  const meta = `${content.mimeType ?? "?"}${caption ? ` · ${caption}` : ""
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
