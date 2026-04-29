import * as React from "react";
import {
  AlertCircle,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Zap,
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
import {
  extractTemplateVariables,
  type CompleteResult,
  type MCPPrompt,
  type MCPResourceTemplate,
} from "@/data/types";
import { cn } from "@/lib/utils";

interface RefOption {
  id: string;
  label: string;
  args: string[];
}

interface CompleteState {
  loading: boolean;
  result?: CompleteResult;
  error?: string;
  durationMs?: number;
}

export function CompletionsPage() {
  const { server, data, connectionState: state } = useConnectionStore();

  if (!data && state === "connecting") {
    return (
      <PageShell title="Completions">
        <div className="rounded-xl border border-border/60 bg-card/30 px-6 py-12 grid place-items-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      </PageShell>
    );
  }
  if (!data) {
    return (
      <PageShell title="Completions">
        <Empty
          title="Not connected"
          description="Connect to this server to use completions."
        />
      </PageShell>
    );
  }
  if (!data.capabilities.completions) {
    return (
      <PageShell title="Completions">
        <Empty
          icon={Sparkles}
          title="Completions not supported"
          description="This server didn't advertise the `completions` capability in its initialize response."
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Completions"
      description="Ask the server to autocomplete an argument value. Useful for cascading dropdowns where one argument depends on another."
    >
      <CompletionsPlayground
        serverName={server!.name}
        prompts={data.prompts}
        templates={data.resourceTemplates}
      />
    </PageShell>
  );
}

function CompletionsPlayground({
  serverName,
  prompts,
  templates,
}: {
  serverName: string;
  prompts: MCPPrompt[];
  templates: MCPResourceTemplate[];
}) {
  const promptRefs: RefOption[] = React.useMemo(
    () =>
      prompts
        .filter((p) => (p.arguments?.length ?? 0) > 0)
        .map((p) => ({
          id: p.name,
          label: p.name,
          args: p.arguments?.map((a) => a.name) ?? [],
        })),
    [prompts],
  );

  const templateRefs: RefOption[] = React.useMemo(
    () =>
      templates.map((t) => ({
        id: t.uriTemplate,
        label: t.name,
        args: extractTemplateVariables(t.uriTemplate),
      })),
    [templates],
  );

  const initialRefType: "prompt" | "resource" =
    promptRefs.length > 0 ? "prompt" : "resource";

  const [refType, setRefType] = React.useState<"prompt" | "resource">(
    initialRefType,
  );
  const refs = refType === "prompt" ? promptRefs : templateRefs;
  const [refId, setRefId] = React.useState<string>(refs[0]?.id ?? "");
  const currentRef = refs.find((r) => r.id === refId) ?? refs[0];

  const [argument, setArgument] = React.useState<string>(
    currentRef?.args[0] ?? "",
  );
  const [value, setValue] = React.useState("");
  const [contextPairs, setContextPairs] = React.useState<
    Array<{ key: string; value: string }>
  >([]);
  const [state, setState] = React.useState<CompleteState>({ loading: false });

  React.useEffect(() => {
    setRefId(refs[0]?.id ?? "");
  }, [refType, refs]);

  React.useEffect(() => {
    if (currentRef && !currentRef.args.includes(argument)) {
      setArgument(currentRef.args[0] ?? "");
    }
  }, [currentRef, argument]);

  const onRun = React.useCallback(async () => {
    if (!currentRef || !argument) return;
    setState({ loading: true });
    try {
      const t0 = performance.now();
      const context: Record<string, string> = {};
      for (const { key, value: v } of contextPairs) {
        if (key.trim() !== "") context[key.trim()] = v;
      }
      const r = await api.complete(serverName, {
        refType,
        ref: currentRef.id,
        argument,
        ...(value !== "" ? { value } : {}),
        ...(Object.keys(context).length > 0 ? { context } : {}),
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
  }, [serverName, refType, currentRef, argument, value, contextPairs]);

  if (promptRefs.length === 0 && templateRefs.length === 0) {
    return (
      <Empty
        icon={Sparkles}
        title="Nothing to complete"
        description="This server has no prompts (with arguments) or resource templates to autocomplete against."
      />
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Completion request</CardTitle>
          <CardDescription className="hidden md:block">
            <code className="font-mono">completion/complete</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Reference type</Label>
            <div className="grid grid-cols-2 gap-2">
              <RefButton
                active={refType === "prompt"}
                onClick={() => setRefType("prompt")}
                disabled={promptRefs.length === 0}
              >
                prompt
              </RefButton>
              <RefButton
                active={refType === "resource"}
                onClick={() => setRefType("resource")}
                disabled={templateRefs.length === 0}
              >
                resource
              </RefButton>
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              {refType === "prompt" ? "Prompt name" : "Resource template"}
            </Label>
            {refs.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                No {refType}s available.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {refs.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRefId(r.id)}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-sm font-mono transition-colors cursor-pointer",
                      refId === r.id
                        ? "border-info/40 bg-info/10 text-info"
                        : "border-border/60 bg-card/40 text-muted-foreground hover:bg-accent/40",
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Argument</Label>
            {currentRef && currentRef.args.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {currentRef.args.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setArgument(a)}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-sm font-mono transition-colors cursor-pointer",
                      argument === a
                        ? "border-success/40 bg-success/10 text-success"
                        : "border-border/60 bg-card/40 text-muted-foreground hover:bg-accent/40",
                    )}
                  >
                    {a}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                No argument names exposed.
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Partial value</Label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. eng"
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Sibling context (cascading)</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setContextPairs((p) => [...p, { key: "", value: "" }])
                }
              >
                <Plus className="size-3.5" />
                Add pair
              </Button>
            </div>
            {contextPairs.length === 0 ? (
              <div className="text-xs text-muted-foreground/80">
                No sibling arguments. The server will treat this as a top-level
                lookup.
              </div>
            ) : (
              <div className="space-y-2">
                {contextPairs.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      value={p.key}
                      onChange={(e) =>
                        setContextPairs((all) =>
                          all.map((x, i) =>
                            i === idx ? { ...x, key: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="key"
                      className="font-mono"
                    />
                    <Input
                      value={p.value}
                      onChange={(e) =>
                        setContextPairs((all) =>
                          all.map((x, i) =>
                            i === idx ? { ...x, value: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="value"
                      className="font-mono"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove"
                      onClick={() =>
                        setContextPairs((all) =>
                          all.filter((_, i) => i !== idx),
                        )
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-2">
            <Button
              variant="success"
              size="sm"
              className="w-full"
              onClick={onRun}
              disabled={state.loading || !currentRef || !argument}
            >
              {state.loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Zap className="size-3.5" />
              )}
              Run completion
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-5 min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
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
                {state.result.completion.values.length}
                {state.result.completion.total != null
                  ? ` / ${state.result.completion.total}`
                  : ""}
                {state.durationMs != null && ` · ${state.durationMs}ms`}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-2">
            {state.error ? (
              <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                <AlertCircle className="size-4 mt-0.5 text-destructive shrink-0" />
                <span className="break-all">{state.error}</span>
              </div>
            ) : state.result ? (
              state.result.completion.values.length === 0 ? (
                <Empty title="No completions" description="The server returned an empty list." />
              ) : (
                state.result.completion.values.map((r, i) => (
                  <button
                    key={`${r}-${i}`}
                    type="button"
                    onClick={() => setValue(r)}
                    className="flex w-full items-center gap-4 rounded-md border border-border/40 bg-card/30 px-4 py-3 text-left transition-colors hover:bg-accent/40 cursor-pointer"
                  >
                    <Sparkles className="size-3.5 text-info shrink-0" />
                    <span className="font-mono text-sm flex-1 break-all">
                      {r}
                    </span>
                  </button>
                ))
              )
            ) : (
              <div className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                Run a completion to see suggestions.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Wire payload</CardTitle>
            <CardDescription className="hidden md:block">
              Sent as <code className="font-mono">params</code>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock language="application/json">
              {JSON.stringify(
                buildPayload(refType, currentRef?.id ?? "", argument, value, contextPairs),
                null,
                2,
              )}
            </CodeBlock>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function buildPayload(
  refType: "prompt" | "resource",
  refId: string,
  argument: string,
  value: string,
  contextPairs: Array<{ key: string; value: string }>,
) {
  const ref =
    refType === "prompt"
      ? { type: "ref/prompt", name: refId }
      : { type: "ref/resource", uri: refId };
  const ctx: Record<string, string> = {};
  for (const { key, value: v } of contextPairs) {
    if (key.trim() !== "") ctx[key.trim()] = v;
  }
  const payload: Record<string, unknown> = {
    ref,
    argument: { name: argument, value },
  };
  if (Object.keys(ctx).length > 0) {
    payload["context"] = { arguments: ctx };
  }
  return payload;
}

function RefButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-md border px-4 py-2.5 text-base font-mono transition-colors cursor-pointer",
        disabled && "opacity-40 cursor-not-allowed",
        active
          ? "border-foreground/40 bg-card/70 text-foreground"
          : "border-border/60 bg-card/30 text-muted-foreground hover:bg-accent/40",
      )}
    >
      {children}
    </button>
  );
}
