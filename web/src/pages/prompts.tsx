import * as React from "react";
import {
  AlertCircle,
  Loader2,
  MessageSquare,
  Play,
  Search,
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
import { CodeBlock } from "@/components/code-block";
import { Empty } from "@/components/empty";
import { PageShell } from "@/components/page-shell";
import { useConnectionStore } from "@/stores/connection-store";
import { api, ApiError } from "@/data/api";
import type { GetPromptResult, MCPPrompt } from "@/data/types";
import { cn } from "@/lib/utils";

export function PromptsPage() {
  const { server, data, connectionState: state } = useConnectionStore();
  const [query, setQuery] = React.useState("");
  const [selectedName, setSelectedName] = React.useState<string | null>(null);

  if (!server) return null;

  const prompts = data?.prompts ?? [];

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.title?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q),
    );
  }, [query, prompts]);

  React.useEffect(() => {
    if (!selectedName || !prompts.find((p) => p.name === selectedName)) {
      setSelectedName(prompts[0]?.name ?? null);
    }
  }, [prompts, selectedName]);

  const selected = prompts.find((p) => p.name === selectedName) ?? null;

  if (!data && state === "connecting") {
    return (
      <PageShell title="Prompts">
        <div className="rounded-xl border border-border/60 bg-card/30 px-6 py-12 grid place-items-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      </PageShell>
    );
  }
  if (!data) {
    return (
      <PageShell title="Prompts">
        <Empty
          title="Not connected"
          description="Connect to this server to see its prompts."
        />
      </PageShell>
    );
  }
  if (prompts.length === 0) {
    return (
      <PageShell title="Prompts">
        <Empty
          icon={MessageSquare}
          title="No prompts advertised"
          description="This server didn't return any prompts from `prompts/list`."
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Prompts"
      description="Reusable prompt templates with optional arguments. Resolve them via `prompts/get` to receive structured chat messages."
      actions={
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter prompts…"
            className="pl-8 w-72"
          />
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Prompts</CardTitle>
            <Badge variant="muted" className="font-mono">
              {filtered.length}
            </Badge>
          </CardHeader>
          <div className="divide-y divide-border/50">
            {filtered.map((p) => (
              <PromptListRow
                key={p.name}
                prompt={p}
                isActive={p.name === selectedName}
                onSelect={() => setSelectedName(p.name)}
              />
            ))}
          </div>
        </Card>

        {selected && (
          <PromptDetail
            key={selected.name}
            serverName={server!.name}
            prompt={selected}
          />
        )}
      </div>
    </PageShell>
  );
}

function PromptListRow({
  prompt,
  isActive,
  onSelect,
}: {
  prompt: MCPPrompt;
  isActive: boolean;
  onSelect: () => void;
}) {
  const argCount = prompt.arguments?.length ?? 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-4 px-6 py-4 text-left transition-colors cursor-pointer",
        isActive ? "bg-accent/40" : "hover:bg-accent/20",
      )}
    >
      <MessageSquare className="size-4 text-muted-foreground mt-1" />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-base">{prompt.name}</div>
        {prompt.description && (
          <div className="text-sm text-muted-foreground line-clamp-2 mt-1">
            {prompt.description}
          </div>
        )}
      </div>
      {argCount > 0 && (
        <Badge variant="muted" className="font-mono">
          {argCount} arg{argCount === 1 ? "" : "s"}
        </Badge>
      )}
    </button>
  );
}

interface GetState {
  loading: boolean;
  result?: GetPromptResult;
  error?: string;
  durationMs?: number;
}

function PromptDetail({
  serverName,
  prompt,
}: {
  serverName: string;
  prompt: MCPPrompt;
}) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [state, setState] = React.useState<GetState>({ loading: false });

  React.useEffect(() => {
    setValues({});
    setErrors({});
    setState({ loading: false });
  }, [prompt.name]);

  const onGet = React.useCallback(async () => {
    const errs: Record<string, string> = {};
    for (const arg of prompt.arguments ?? []) {
      if (arg.required && !values[arg.name]) errs[arg.name] = "required";
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setState({ loading: true });
    try {
      const t0 = performance.now();
      const stringified: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v !== "") stringified[k] = v;
      }
      const r = await api.getPrompt(serverName, {
        name: prompt.name,
        arguments: stringified,
      });
      setState({
        loading: false,
        result: r,
        durationMs: Math.round(performance.now() - t0),
      });
    } catch (e) {
      setState({
        loading: false,
        error: e instanceof ApiError ? e.message : (e as Error).message,
      });
    }
  }, [serverName, prompt, values]);

  return (
    <div className="space-y-5 min-w-0">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1.5 min-w-0">
            <CardTitle className="flex items-center gap-2.5 flex-wrap">
              <span className="font-mono">{prompt.name}</span>
              {prompt.title && (
                <span className="font-normal text-sm text-muted-foreground">
                  · {prompt.title}
                </span>
              )}
            </CardTitle>
            {prompt.description && (
              <CardDescription>{prompt.description}</CardDescription>
            )}
          </div>
          <Button
            variant="success"
            size="sm"
            onClick={onGet}
            disabled={state.loading}
          >
            {state.loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            Get prompt
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {!prompt.arguments?.length ? (
            <div className="rounded-md border border-dashed border-border/60 px-5 py-8 text-center text-sm text-muted-foreground">
              This prompt takes no arguments.
            </div>
          ) : (
            prompt.arguments.map((arg) => (
              <div key={arg.name} className="space-y-2">
                <Label className="flex items-center gap-2.5">
                  <span className="font-mono normal-case text-foreground">
                    {arg.name}
                  </span>
                  {arg.required && (
                    <Badge variant="warning" className="font-mono">
                      required
                    </Badge>
                  )}
                </Label>
                {arg.description && (
                  <div className="text-sm text-muted-foreground/80">
                    {arg.description}
                  </div>
                )}
                <Input
                  value={values[arg.name] ?? ""}
                  onChange={(e) =>
                    setValues((s) => ({ ...s, [arg.name]: e.target.value }))
                  }
                  className="font-mono"
                  placeholder="value"
                />
                {errors[arg.name] && (
                  <div className="text-xs text-destructive">
                    {errors[arg.name]}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resolved messages</CardTitle>
          {state.loading ? (
            <Badge variant="muted">
              <Loader2 className="size-3 animate-spin" />
              running…
            </Badge>
          ) : state.error ? (
            <Badge variant="destructive">
              <AlertCircle className="size-3" />
              error
            </Badge>
          ) : state.result ? (
            <Badge variant="success">
              {state.result.messages.length} message
              {state.result.messages.length === 1 ? "" : "s"}
              {state.durationMs != null && ` · ${state.durationMs}ms`}
              {state.result._tokenCount != null && ` · ${state.result._tokenCount.toLocaleString()} tokens`}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent>
          {state.error ? (
            <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
              <AlertCircle className="size-4 mt-0.5 text-destructive shrink-0" />
              <span className="break-all">{state.error}</span>
            </div>
          ) : state.result ? (
            <PromptResultView result={state.result} />
          ) : (
            <div className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
              Resolve the prompt to see its messages.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PromptResultView({ result }: { result: GetPromptResult }) {
  return (
    <div className="space-y-3">
      {result.description && (
        <div className="text-sm text-muted-foreground italic">
          {result.description}
        </div>
      )}
      {result.messages.map((msg, i) => (
        <div
          key={i}
          className="rounded-md border border-border/60 bg-card/30 overflow-hidden"
        >
          <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-2 text-xs font-mono">
            <Badge
              variant={msg.role === "user" ? "info" : "success"}
              className="font-mono"
            >
              {msg.role}
            </Badge>
            <span className="text-muted-foreground/70">
              {msg.content.type}
            </span>
          </div>
          <div className="p-4">
            {msg.content.type === "text" ? (
              <pre className="text-sm font-mono whitespace-pre-wrap">
                {msg.content.text}
              </pre>
            ) : (
              <CodeBlock language="application/json">
                {JSON.stringify(msg.content, null, 2)}
              </CodeBlock>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
