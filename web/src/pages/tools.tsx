import * as React from "react";
import {
  AlertCircle,
  Asterisk,
  Hammer,
  Loader2,
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
import { Textarea } from "@/components/ui/textarea";
import { CodeBlock } from "@/components/code-block";
import { Empty } from "@/components/empty";
import { PageShell } from "@/components/page-shell";
import { useConnectionStore } from "@/stores/connection-store";
import { useToolArgsStore } from "@/stores/tool-args-store";
import { api, ApiError } from "@/data/api";
import type { MCPTool, MCPToolSchemaProperty, ToolResult } from "@/data/types";
import { cn } from "@/lib/utils";

export function ToolsPage() {
  const { server, data, connectionState: state } = useConnectionStore();
  const [query, setQuery] = React.useState("");
  const [selectedName, setSelectedName] = React.useState<string | null>(null);

  if (!server) return null;

  const tools = data?.tools ?? [];

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.title?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q),
    );
  }, [query, tools]);

  React.useEffect(() => {
    if (!selectedName || !tools.find((t) => t.name === selectedName)) {
      setSelectedName(tools[0]?.name ?? null);
    }
  }, [tools, selectedName]);

  const selected = tools.find((t) => t.name === selectedName) ?? null;

  if (!data && state === "connecting") {
    return (
      <PageShell title="Tools">
        <div className="rounded-xl border border-border/60 bg-card/30 px-6 py-12 grid place-items-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      </PageShell>
    );
  }
  if (!data) {
    return (
      <PageShell title="Tools">
        <Empty
          title="Not connected"
          description="Connect to this server to see its tools."
        />
      </PageShell>
    );
  }
  if (tools.length === 0) {
    return (
      <PageShell title="Tools">
        <Empty
          icon={Hammer}
          title="No tools advertised"
          description="This server didn't return any tools from `tools/list`."
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Tools"
      description="Functions exposed by the server. Each tool advertises a JSON-Schema for its arguments and is invoked through the `tools/call` request."
      actions={
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter tools…"
            className="pl-8 w-72"
          />
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card className="overflow-hidden lg:sticky lg:top-20 self-start max-h-[calc(100vh-7rem)] flex flex-col">
          <CardHeader>
            <CardTitle>Available tools</CardTitle>
            <Badge variant="muted" className="font-mono">
              {filtered.length}
            </Badge>
          </CardHeader>
          <div className="divide-y divide-border/50 overflow-y-auto min-h-0">
            {filtered.map((t) => (
              <ToolListRow
                key={t.name}
                tool={t}
                isActive={t.name === selectedName}
                onSelect={() => setSelectedName(t.name)}
              />
            ))}
            {filtered.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                No tools match.
              </div>
            )}
          </div>
        </Card>

        {selected && <ToolDetail key={selected.name} serverName={server!.name} tool={selected} />}
      </div>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */

function ToolListRow({
  tool,
  isActive,
  onSelect,
}: {
  tool: MCPTool;
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
      <Hammer className="size-4 text-muted-foreground mt-1" />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-base">{tool.name}</div>
        {tool.description && (
          <div className="text-sm text-muted-foreground line-clamp-2 mt-1">
            {tool.description}
          </div>
        )}
      </div>
    </button>
  );
}

interface CallState {
  loading: boolean;
  result?: ToolResult;
  error?: string;
  durationMs?: number;
}

function ToolDetail({
  serverName,
  tool,
}: {
  serverName: string;
  tool: MCPTool;
}) {
  const properties = tool.inputSchema.properties ?? {};
  const required = new Set(tool.inputSchema.required ?? []);

  const initial = React.useMemo(() => {
    const init: Record<string, string> = {};
    for (const [name, prop] of Object.entries(properties)) {
      if (prop.default !== undefined) init[name] = String(prop.default);
      else init[name] = "";
    }
    return init;
  }, [properties]);

  // Persist argument values in Zustand so they survive navigation.
  const { getArgs, setArg } = useToolArgsStore();
  const cached = getArgs(serverName, tool.name);
  const values = cached ?? initial;

  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [callState, setCallState] = React.useState<CallState>({ loading: false });

  // When the tool's schema changes (different tool selected while mounted),
  // reset errors and call state but keep cached args.
  React.useEffect(() => {
    setErrors({});
    setCallState({ loading: false });
  }, [tool.name]);

  const argsResult = React.useMemo(
    () => coerceArguments(values, properties, required),
    [values, properties, required],
  );

  const onCall = React.useCallback(async () => {
    if (Object.keys(argsResult.errors).length > 0) {
      setErrors(argsResult.errors);
      return;
    }
    setErrors({});
    setCallState({ loading: true });
    try {
      const t0 = performance.now();
      const result = await api.callTool(serverName, {
        name: tool.name,
        arguments: argsResult.value,
      });
      setCallState({
        loading: false,
        result,
        durationMs: Math.round(performance.now() - t0),
      });
    } catch (e) {
      setCallState({
        loading: false,
        error: e instanceof ApiError ? e.message : (e as Error).message,
      });
    }
  }, [serverName, tool.name, argsResult]);

  const hasArgs = Object.keys(properties).length > 0;
  const canCall = !callState.loading && Object.keys(argsResult.errors).length === 0;

  return (
    <div className="space-y-5 min-w-0">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1.5 min-w-0">
            <CardTitle className="flex items-center gap-2.5 flex-wrap">
              <span className="font-mono">{tool.name}</span>
              {tool.title && (
                <span className="text-muted-foreground font-normal text-sm">
                  · {tool.title}
                </span>
              )}
            </CardTitle>
            {tool.description && (
              <CardDescription>{tool.description}</CardDescription>
            )}
          </div>
          <Button
            variant="success"
            size="sm"
            onClick={onCall}
            disabled={!canCall}
          >
            {callState.loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            Call tool
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {!hasArgs ? (
            <div className="rounded-md border border-dashed border-border/60 px-5 py-8 text-center text-sm text-muted-foreground">
              This tool takes no arguments.
            </div>
          ) : (
            <div className="space-y-5">
              {Object.entries(properties).map(([name, prop]) => (
                <ArgField
                  key={name}
                  name={name}
                  prop={prop}
                  required={required.has(name)}
                  value={values[name] ?? ""}
                  onChange={(v) =>
                    setArg(serverName, tool.name, name, v)
                  }
                  error={errors[name]}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Arguments preview</CardTitle>
            <CardDescription className="hidden md:block">
              Wire payload sent to <code className="font-mono">tools/call</code>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock language="application/json" caption="--args">
              {JSON.stringify(argsResult.value, null, 2)}
            </CodeBlock>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
            {callState.loading ? (
              <Badge variant="muted">
                <Loader2 className="size-3 animate-spin" />
                running…
              </Badge>
            ) : callState.error ? (
              <Badge variant="destructive">
                <AlertCircle className="size-3" />
                error
              </Badge>
            ) : callState.result ? (
              <Badge variant={callState.result.isError ? "destructive" : "success"}>
                {callState.result.isError ? "isError" : "ok"}
                {callState.durationMs != null && ` · ${callState.durationMs}ms`}
                {callState.result._tokenCount != null && ` · ${callState.result._tokenCount.toLocaleString()} tokens`}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent>
            <ToolResultView state={callState} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form fields                                                         */
/* ------------------------------------------------------------------ */

function ArgField({
  name,
  prop,
  required,
  value,
  onChange,
  error,
}: {
  name: string;
  prop: MCPToolSchemaProperty;
  required: boolean;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const type = Array.isArray(prop.type) ? prop.type.join("|") : (prop.type ?? "any");

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2.5">
        <span className="font-mono normal-case text-foreground">{name}</span>
        <Badge variant="muted" className="font-mono">
          {type}
        </Badge>
        {required && (
          <span className="inline-flex items-center text-warning">
            <Asterisk className="size-3.5" />
            <span className="text-[11px] uppercase tracking-wider">
              required
            </span>
          </span>
        )}
      </Label>
      {prop.description && (
        <div className="text-sm text-muted-foreground/80">{prop.description}</div>
      )}
      {prop.enum ? (
        <div className="flex flex-wrap gap-1.5">
          {prop.enum.map((opt) => (
            <button
              key={String(opt)}
              type="button"
              onClick={() => onChange(String(opt))}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-mono transition-colors cursor-pointer",
                value === String(opt)
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-border/60 bg-card/40 text-muted-foreground hover:bg-accent/40",
              )}
            >
              {String(opt)}
            </button>
          ))}
        </div>
      ) : type === "boolean" ? (
        <div className="flex gap-1.5">
          {["true", "false"].map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-mono transition-colors cursor-pointer",
                value === opt
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-border/60 bg-card/40 text-muted-foreground hover:bg-accent/40",
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : type === "object" || type === "array" ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={type === "array" ? "[]" : "{}"}
          rows={4}
        />
      ) : (
        <Input
          type={type === "number" || type === "integer" ? "number" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            prop.default !== undefined
              ? `default: ${String(prop.default)}`
              : type === "number" || type === "integer"
                ? "0"
                : "value"
          }
          className="font-mono"
        />
      )}
      {error && (
        <div className="text-xs text-destructive">{error}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Result rendering                                                    */
/* ------------------------------------------------------------------ */

function ToolResultView({ state }: { state: CallState }) {
  if (state.error) {
    return (
      <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
        <AlertCircle className="size-4 mt-0.5 text-destructive shrink-0" />
        <span className="break-all">{state.error}</span>
      </div>
    );
  }
  if (!state.result) {
    return (
      <div className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
        Call the tool to see a response.
      </div>
    );
  }
  const r = state.result;
  return (
    <div className="space-y-3">
      {r.content.map((block, i) => (
        <ContentBlockView key={i} block={block} />
      ))}
      {r.structuredContent !== undefined && (
        <CodeBlock language="application/json" caption="structuredContent">
          {JSON.stringify(r.structuredContent, null, 2)}
        </CodeBlock>
      )}
    </div>
  );
}

function ContentBlockView({ block }: { block: ToolResult["content"][number] }) {
  if (block.type === "text") {
    return (
      <CodeBlock language="text" caption="text">
        {block.text}
      </CodeBlock>
    );
  }
  if (block.type === "image") {
    return (
      <div className="rounded-md border border-border/60 bg-card/30 p-3 space-y-2">
        <div className="text-xs text-muted-foreground/80 font-mono">
          image · {block.mimeType}
        </div>
        <img
          src={`data:${block.mimeType};base64,${block.data}`}
          alt="tool result"
          className="max-w-full rounded"
        />
      </div>
    );
  }
  if (block.type === "audio") {
    return (
      <div className="rounded-md border border-border/60 bg-card/30 p-3 space-y-2">
        <div className="text-xs text-muted-foreground/80 font-mono">
          audio · {block.mimeType}
        </div>
        <audio
          controls
          src={`data:${block.mimeType};base64,${block.data}`}
          className="w-full"
        />
      </div>
    );
  }
  if (block.type === "resource") {
    const inner = block.resource;
    return (
      <div className="rounded-md border border-border/60 bg-card/30 p-3 space-y-2">
        <div className="text-xs text-muted-foreground/80 font-mono">
          embedded resource · {inner.uri}
        </div>
        {inner.text != null ? (
          <CodeBlock language={inner.mimeType ?? "text"}>
            {inner.text}
          </CodeBlock>
        ) : (
          <div className="text-xs text-muted-foreground">
            binary blob ({inner.mimeType ?? "?"})
          </div>
        )}
      </div>
    );
  }
  if (block.type === "resource_link") {
    return (
      <div className="rounded-md border border-border/60 bg-card/30 p-3 text-sm">
        <span className="text-xs text-muted-foreground/80 font-mono">
          link
        </span>
        <div className="font-mono mt-1 break-all">{block.uri}</div>
        {block.description && (
          <div className="text-xs text-muted-foreground mt-1">
            {block.description}
          </div>
        )}
      </div>
    );
  }
  return (
    <CodeBlock language="application/json" caption="unknown block">
      {JSON.stringify(block, null, 2)}
    </CodeBlock>
  );
}

/* ------------------------------------------------------------------ */
/* Coercion: form strings → typed JSON                                 */
/* ------------------------------------------------------------------ */

function coerceArguments(
  values: Record<string, string>,
  properties: Record<string, MCPToolSchemaProperty>,
  required: Set<string>,
): { value: Record<string, unknown>; errors: Record<string, string> } {
  const out: Record<string, unknown> = {};
  const errs: Record<string, string> = {};

  for (const [name, raw] of Object.entries(values)) {
    const prop = properties[name];
    if (!prop) continue;
    const isRequired = required.has(name);
    const trimmed = raw.trim();

    if (trimmed === "") {
      if (isRequired) errs[name] = "required";
      continue;
    }

    const type = Array.isArray(prop.type) ? prop.type[0] : prop.type;
    switch (type) {
      case "number":
      case "integer": {
        const n = Number(trimmed);
        if (Number.isNaN(n)) {
          errs[name] = "must be a number";
        } else if (type === "integer" && !Number.isInteger(n)) {
          errs[name] = "must be an integer";
        } else if (prop.minimum != null && n < prop.minimum) {
          errs[name] = `must be ≥ ${prop.minimum}`;
        } else if (prop.maximum != null && n > prop.maximum) {
          errs[name] = `must be ≤ ${prop.maximum}`;
        } else {
          out[name] = n;
        }
        break;
      }
      case "boolean":
        out[name] = trimmed === "true";
        break;
      case "object":
      case "array":
        try {
          out[name] = JSON.parse(trimmed);
        } catch (e) {
          errs[name] = `invalid JSON: ${(e as Error).message}`;
        }
        break;
      default:
        out[name] = trimmed;
    }
  }
  return { value: out, errors: errs };
}
