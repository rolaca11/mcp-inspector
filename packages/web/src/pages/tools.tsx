import * as React from "react";
import {
  AlertCircle,
  AppWindow,
  Asterisk,
  ChevronDown,
  FolderOpen,
  Hammer,
  Loader2,
  Play,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Controller, type Control, type FieldValues } from "react-hook-form";

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
import { EditableJsonBlock } from "@/components/editable-json-block";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { CodeBlock } from "@/components/code-block";
import { ErrorMessage } from "@/components/error-message";
import { Empty } from "@/components/empty";
import { PageShell } from "@/components/page-shell";
import { useConnectionStore } from "@/stores/connection-store";
import { useResultStore } from "@/stores/result-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useSyncedForm } from "@/hooks/use-synced-form";
import {
  mcpSchemaToZod,
  partialCoerce,
  reverseCoerceArguments,
  resolveSchemaRefs,
  resolveSchemaPropertyRef,
  resolveSchemaType,
  schemaAlternativeOptions,
} from "@/lib/schema-builder";
import { api, ApiError, type SavedForm } from "@/data/api";
import type {
  ActivityResult,
  MCPTool,
  MCPToolSchema,
  MCPToolSchemaProperty,
  ToolResult,
} from "@/data/types";
import { cn } from "@/lib/utils";
import { MarkdownDescription } from "@/components/markdown-description";
import { McpAppFrame } from "@/components/mcp-app-frame";
import { isUiResourceUri, toolUiResourceUri } from "@/lib/mcp-apps";
import {
  appPayloadFromContent,
  pickAppContent,
  type AppPayload,
} from "@/lib/app-content";

type ZodIssueLike = {
  code: string;
  message: string;
  values?: readonly unknown[];
  expected?: string;
  input?: unknown;
};

/** Turn a zod issue into a short, tooltip-friendly message. */
function conciseIssueMessage(issue: ZodIssueLike): string {
  switch (issue.code) {
    case "invalid_value": {
      const values = issue.values ?? [];
      if (values.length === 0) return "Invalid option";
      if (values.length <= 4) {
        return `must be one of: ${values.map(String).join(", ")}`;
      }
      return `must be one of ${values.length} allowed values`;
    }
    case "invalid_type":
      return issue.input === undefined
        ? "Required"
        : `must be a ${issue.expected ?? "valid value"}`;
    case "too_small":
      return "Required";
    default:
      return issue.message;
  }
}

export function ToolsPage() {
  const { server, data, connectionState: state } = useConnectionStore();
  const selectionStore = useSelectionStore();
  const [query, setQuery] = React.useState("");

  const tools = data?.tools ?? [];

  const storedName = server ? selectionStore.get(server.id, "tools") : undefined;
  const selectedName = storedName && tools.find((t) => t.name === storedName)
    ? storedName
    : (tools[0]?.name ?? null);

  const setSelectedName = React.useCallback(
    (name: string) => {
      if (server) selectionStore.set(server.id, "tools", name);
    },
    [server, selectionStore],
  );

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

  const selected = tools.find((t) => t.name === selectedName) ?? null;

  if (!server) return null;

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
      <div className="grid gap-10 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-32 self-start flex flex-col">
          <div className="overflow-y-auto min-h-0 flex flex-col gap-1 px-1">
            {filtered.map((t) => (
              <ToolListRow
                key={t.name}
                tool={t}
                isActive={t.name === selectedName}
                onSelect={() => setSelectedName(t.name)}
              />
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                No tools match.
              </div>
            )}
          </div>
        </div>

        {selected && <ToolDetail key={selected.name} serverName={server!.id} tool={selected} />}
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
  const hasUi = toolUiResourceUri(tool._meta) !== undefined;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-4 py-2 text-left text-sm transition-colors cursor-pointer",
        isActive
          ? "bg-accent text-foreground font-medium"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="truncate">{tool.title ?? tool.name}</span>
      {hasUi && (
        <AppWindow
          className="ml-auto size-3.5 shrink-0 text-info"
          aria-label="Has an app UI"
        />
      )}
    </button>
  );
}

interface CallState {
  loading: boolean;
  activity?: ActivityResult<ToolResult>;
  error?: string;
  errorResponse?: Record<string, unknown>;
  /** Arguments actually sent — fed to a linked app as its tool input. */
  input?: Record<string, unknown>;
}

function ToolDetail({
  serverName,
  tool,
}: {
  serverName: string;
  tool: MCPTool;
}) {
  const resolvedSchema = React.useMemo(
    () => resolveSchemaRefs(tool.inputSchema),
    [tool.inputSchema],
  );
  const properties = resolvedSchema.properties ?? {};
  const required = new Set(resolvedSchema.required ?? []);

  const initial = React.useMemo(() => {
    const init: Record<string, string> = {};
    for (const [name, prop] of Object.entries(properties)) {
      if (prop.default !== undefined) init[name] = typeof prop.default === "object" && prop.default !== null
        ? JSON.stringify(prop.default)
        : String(prop.default);
      else init[name] = "";
    }
    return init;
  }, [properties]);

  const schema = React.useMemo(
    () => mcpSchemaToZod(resolvedSchema),
    [resolvedSchema],
  );

  const form = useSyncedForm({
    serverName,
    formKey: tool.name,
    schema,
    defaults: initial,
  });

  const { formState, handleSubmit, watch, setAllValues } = form;

  const resultStore = useResultStore();
  const [loading, setLoading] = React.useState(false);
  const [jsonError, setJsonError] = React.useState<string | null>(null);

  const uiResourceUri = toolUiResourceUri(tool._meta);

  const cachedResult = resultStore.get<CallState>(serverName, "tool", tool.name);
  const callState: CallState = loading ? { loading: true } : (cachedResult ?? { loading: false });

  const watchedValues = watch() as Record<string, string>;

  const canonicalJson = React.useMemo(() => {
    const parsed = schema.safeParse(watchedValues);
    if (parsed.success) return JSON.stringify(parsed.data, null, 2);
    return JSON.stringify(partialCoerce(watchedValues, properties), null, 2);
  }, [watchedValues, schema, properties]);

  const onJsonChange = React.useCallback(
    (text: string) => {
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          setJsonError("must be an object");
          return;
        }
        setJsonError(null);
        const reversed = reverseCoerceArguments(parsed, properties);
        setAllValues(reversed);
      } catch {
        setJsonError("invalid JSON");
      }
    },
    [properties, setAllValues],
  );

  const onJsonBlur = React.useCallback(() => {
    setJsonError(null);
  }, []);

  const onCall = React.useCallback(
    () =>
      void handleSubmit(async (coercedData) => {
        setLoading(true);
        try {
          const args = coercedData as Record<string, unknown>;
          const activities = await api.callTool(serverName, {
            name: tool.name,
            arguments: args,
          });
          const settled: CallState = {
            loading: false,
            activity: activities[0],
            input: args,
          };
          resultStore.set(serverName, "tool", tool.name, settled);
        } catch (e) {
          const settled: CallState = {
            loading: false,
            error: e instanceof ApiError ? e.message : (e as Error).message,
            errorResponse: e instanceof ApiError ? e.responseBody : undefined,
          };
          resultStore.set(serverName, "tool", tool.name, settled);
        } finally {
          setLoading(false);
        }
      })(),
    [serverName, tool.name, handleSubmit, resultStore],
  );

  const hasArgs = Object.keys(properties).length > 0;
  const canCall = !callState.loading && formState.isValid;

  // Validate the watched values directly against the schema so the tooltip can
  // describe the issues without touching react-hook-form's error state (which
  // would surface inline errors under each field).
  const validationIssues = React.useMemo(() => {
    const parsed = schema.safeParse(watchedValues);
    if (parsed.success) return [];
    const seen = new Set<string>();
    const issues: { name: string; message: string }[] = [];
    for (const issue of parsed.error.issues) {
      const name = issue.path.length > 0 ? String(issue.path[0]) : "(form)";
      if (seen.has(name)) continue;
      seen.add(name);
      issues.push({ name, message: conciseIssueMessage(issue) });
    }
    return issues;
  }, [schema, watchedValues]);

  return (
    <div className="space-y-5 min-w-0">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5 flex-wrap">
            <span>{tool.title ?? tool.name}</span>
            {tool.title && (
              <span className="text-muted-foreground font-normal text-sm font-mono">
                · {tool.name}
              </span>
            )}
            {uiResourceUri && (
              <Badge
                variant="muted"
                className="gap-1 border-info/40 bg-info/10 text-info"
              >
                <AppWindow className="size-3" />
                app
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {tool.description && (
              <MarkdownDescription>{tool.description}</MarkdownDescription>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {hasArgs && (
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="flex flex-col gap-6">
                {Object.entries(properties).map(([name, prop]) => (
                  <ArgField
                    key={name}
                    name={name}
                    prop={prop}
                    required={required.has(name)}
                    control={form.control}
                    rootSchema={resolvedSchema}
                  />
                ))}
              </div>
              <EditableJsonBlock
                value={canonicalJson}
                onChange={onJsonChange}
                onBlur={onJsonBlur}
                error={jsonError}
                label="--args"
                pasteable
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                {/* span wrapper so the tooltip still receives hover events while the button is disabled */}
                <span className="inline-flex">
                  <Button
                    variant="success"
                    onClick={onCall}
                    disabled={!canCall}
                    className={!canCall ? "pointer-events-none" : undefined}
                  >
                    {callState.loading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Play className="size-4" />
                    )}
                    Call tool
                  </Button>
                </span>
              </TooltipTrigger>
              {!callState.loading && validationIssues.length > 0 && (
                <TooltipContent className="max-w-xs">
                  <p className="font-medium">Fix the following to call this tool:</p>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    {validationIssues.map((issue) => (
                      <li key={issue.name}>
                        <span className="font-mono">{issue.name}</span>: {issue.message}
                      </li>
                    ))}
                  </ul>
                </TooltipContent>
              )}
            </Tooltip>
            {hasArgs && (
              <SavedFormsControls
                serverName={serverName}
                toolName={tool.name}
                getValues={() => watch() as Record<string, string>}
                onLoad={setAllValues}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {uiResourceUri && callState.activity?.outcome === "ok" && callState.activity.result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AppWindow className="size-4 text-info" />
              App
            </CardTitle>
            <CardDescription className="font-mono truncate">
              {uiResourceUri}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ToolAppView
              serverName={serverName}
              resourceUri={uiResourceUri}
              toolName={tool.name}
              toolInput={callState.input}
              toolResult={callState.activity.result}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Result</CardTitle>
          <CardAction>
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
            ) : callState.activity?.outcome === "error" ? (
              <Badge variant="destructive">
                <AlertCircle className="size-3" />
                error
                {callState.activity.durationMs != null && ` · ${callState.activity.durationMs}ms`}
              </Badge>
            ) : callState.activity?.result ? (
              <Badge variant={callState.activity.result.isError ? "destructive" : "success"}>
                {callState.activity.result.isError ? "isError" : "ok"}
                {callState.activity.durationMs != null && ` · ${callState.activity.durationMs}ms`}
                {callState.activity.tokenCount != null && ` · ${callState.activity.tokenCount.toLocaleString()} tokens`}
              </Badge>
            ) : null}
          </CardAction>
        </CardHeader>
        <CardContent>
          <ToolResultView
            state={callState}
            serverName={serverName}
            toolInput={callState.input}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App rendering (MCP Apps / mcp-ui)                                   */
/* ------------------------------------------------------------------ */

interface AppFetchState {
  loading: boolean;
  payload?: AppPayload | null;
  error?: string;
}

/**
 * Fetches a tool's linked `ui://` template and renders it as an app, fed the
 * tool's input arguments and result. Re-fetches when the template URI changes.
 */
function ToolAppView({
  serverName,
  resourceUri,
  toolName,
  toolInput,
  toolResult,
}: {
  serverName: string;
  resourceUri: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolResult: ToolResult;
}) {
  const [state, setState] = React.useState<AppFetchState>({ loading: true });

  React.useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    (async () => {
      try {
        const activities = await api.readResource(serverName, { uri: resourceUri });
        const act = activities[0];
        if (cancelled) return;
        if (!act || act.outcome === "error") {
          setState({ loading: false, error: act?.error ?? "failed to read app resource" });
          return;
        }
        const content = pickAppContent(act.result?.contents ?? []);
        if (!content) {
          setState({ loading: false, payload: null });
          return;
        }
        setState({ loading: false, payload: appPayloadFromContent(content) });
      } catch (e) {
        if (cancelled) return;
        setState({
          loading: false,
          error: e instanceof ApiError ? e.message : (e as Error).message,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverName, resourceUri]);

  if (state.loading) {
    return (
      <div className="rounded-md border border-border/60 bg-card/30 px-4 py-8 grid place-items-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }
  if (state.error) {
    return <ErrorMessage error={state.error} />;
  }
  if (!state.payload) {
    return (
      <div className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
        The linked resource <span className="font-mono">{resourceUri}</span> didn't
        return renderable UI content.
      </div>
    );
  }

  return (
    <McpAppFrame
      serverName={serverName}
      kind={state.payload.kind}
      html={state.payload.html}
      url={state.payload.url}
      meta={state.payload.meta}
      toolInput={toolInput}
      toolResult={toolResult}
      title={`${toolName} · ${resourceUri}`}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Saved forms (persist / load tool input presets)                     */
/* ------------------------------------------------------------------ */

function SavedFormsControls({
  serverName,
  toolName,
  getValues,
  onLoad,
}: {
  serverName: string;
  toolName: string;
  getValues: () => Record<string, string>;
  onLoad: (values: Record<string, string>) => void;
}) {
  const [scoped, setScoped] = React.useState<SavedForm[]>([]);
  const [global, setGlobal] = React.useState<SavedForm[]>([]);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [scope, setScope] = React.useState<"tool" | "global">("tool");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    try {
      const res = await api.savedFormsList(serverName, toolName);
      setScoped(res.scoped);
      setGlobal(res.global);
    } catch {
      /* non-fatal — leave the lists as-is */
    }
  }, [serverName, toolName]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const onSave = React.useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await api.savedFormSave({
        name: trimmed,
        scope,
        serverName: scope === "tool" ? serverName : undefined,
        toolName: scope === "tool" ? toolName : undefined,
        values: getValues(),
      });
      setSaveOpen(false);
      setName("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [name, scope, serverName, toolName, getValues, reload]);

  const onDelete = React.useCallback(
    async (id: string) => {
      try {
        await api.savedFormRemove(id);
        await reload();
      } catch {
        /* non-fatal */
      }
    },
    [reload],
  );

  const hasForms = scoped.length > 0 || global.length > 0;

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setSaveOpen(true)}
        className="border-info/40 bg-info/10 text-info hover:bg-info/20 hover:text-info"
      >
        <Save className="size-4" />
        Save
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            disabled={!hasForms}
            className="border-info/40 bg-info/10 text-info hover:bg-info/20 hover:text-info"
          >
            <FolderOpen className="size-4" />
            Load
            <ChevronDown className="size-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[16rem]">
          {scoped.length > 0 && (
            <>
              <DropdownMenuLabel>This tool</DropdownMenuLabel>
              {scoped.map((f) => (
                <SavedFormRow
                  key={f.id}
                  form={f}
                  onLoad={onLoad}
                  onDelete={onDelete}
                />
              ))}
            </>
          )}
          {scoped.length > 0 && global.length > 0 && (
            <DropdownMenuSeparator />
          )}
          {global.length > 0 && (
            <>
              <DropdownMenuLabel>Global</DropdownMenuLabel>
              {global.map((f) => (
                <SavedFormRow
                  key={f.id}
                  form={f}
                  onLoad={onLoad}
                  onDelete={onDelete}
                />
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save form</DialogTitle>
            <DialogDescription>
              Persist the current input values to reuse them later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="saved-form-name">Name</Label>
              <Input
                id="saved-form-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void onSave();
                }}
                placeholder="e.g. happy path"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Scope</Label>
              <div className="flex gap-1.5">
                {(
                  [
                    ["tool", "This server & tool"],
                    ["global", "Global"],
                  ] as const
                ).map(([value, label]) => {
                  const selected = scope === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setScope(value)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm transition-colors cursor-pointer",
                        selected
                          ? "border-success/40 bg-success/10 text-success"
                          : "border-border bg-black/25 text-muted-foreground hover:bg-accent/40",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            {error && (
              <div className="text-xs text-destructive">{error}</div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setSaveOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={onSave} disabled={saving || !name.trim()}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SavedFormRow({
  form,
  onLoad,
  onDelete,
}: {
  form: SavedForm;
  onLoad: (values: Record<string, string>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={() => onLoad(form.values)}
      className="justify-between gap-3 group/saved"
    >
      <span className="truncate">{form.name}</span>
      <button
        type="button"
        aria-label={`Delete ${form.name}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onDelete(form.id);
        }}
        className="shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-all group-hover/saved:opacity-100 hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </button>
    </DropdownMenuItem>
  );
}

/* ------------------------------------------------------------------ */
/* Form fields                                                         */
/* ------------------------------------------------------------------ */

function ArgField({
  name,
  prop,
  required,
  control,
  rootSchema,
}: {
  name: string;
  prop: MCPToolSchemaProperty;
  required: boolean;
  control: Control<FieldValues>;
  rootSchema: MCPToolSchema;
}) {
  const resolvedProp = resolveSchemaPropertyRef(prop, rootSchema);
  const alternatives = schemaAlternativeOptions(resolvedProp);
  const type = schemaTypeDisplay(resolvedProp);
  const resolvedType = resolveSchemaType(resolvedProp);

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <div className="flex flex-col gap-2">
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
          {resolvedProp.description && <MarkdownDescription className="flex-1 text-muted-foreground/80 ms-4">{resolvedProp.description}</MarkdownDescription>}
          {alternatives ? (
            <StructuredArgFieldWrapper
              field={field}
              prop={resolvedProp}
              rootSchema={rootSchema}
            />
          ) : resolvedProp.enum ? (
            <div className="flex flex-wrap gap-1.5 ms-4">
              {resolvedProp.enum.map((opt) => {
                const selected = field.value === String(opt);
                const nullable = Array.isArray(resolvedProp.type) && resolvedProp.type.includes("null");
                return (
                  <button
                    key={String(opt)}
                    type="button"
                    onClick={() => field.onChange(selected && nullable ? "" : String(opt))}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-sm font-mono transition-colors cursor-pointer",
                      selected
                        ? "border-success/40 bg-success/10 text-success"
                        : "border-border bg-black/25 text-muted-foreground hover:bg-accent/40",
                    )}
                  >
                    {String(opt)}
                  </button>
                );
              })}
            </div>
          ) : resolvedType === "boolean" ? (
            <div className="flex gap-1.5 ms-4">
              {["true", "false"].map((opt) => {
                const selected = field.value === opt;
                const nullable = Array.isArray(resolvedProp.type) && resolvedProp.type.includes("null");
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => field.onChange(selected && nullable ? "" : opt)}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-sm font-mono transition-colors cursor-pointer",
                      selected
                        ? "border-success/40 bg-success/10 text-success"
                        : "border-border bg-black/25 text-muted-foreground hover:bg-accent/40",
                    )}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          ) : resolvedType === "object" && resolvedProp.properties ? (
            <ObjectArgFieldWrapper
              field={field}
              prop={resolvedProp}
              rootSchema={rootSchema}
            />
          ) : resolvedType === "array" && resolvedProp.items && typeof resolvedProp.items === "object" && !Array.isArray(resolvedProp.items) ? (
            <ArrayArgFieldWrapper
              field={field}
              prop={resolvedProp}
              rootSchema={rootSchema}
            />
          ) : resolvedType === "object" || resolvedType === "array" ? (
            <Textarea
              value={field.value ?? ""}
              onChange={(e) => field.onChange(e.target.value)}
              onBlur={field.onBlur}
              placeholder={resolvedType === "array" ? "[]" : "{}"}
              className="ms-4"
              rows={4}
            />
          ) : (
            <Input
              type={resolvedType === "number" || resolvedType === "integer" ? "number" : "text"}
              value={field.value ?? ""}
              onChange={(e) => field.onChange(e.target.value)}
              onBlur={field.onBlur}
              placeholder={
                resolvedProp.default !== undefined
                  ? `default: ${String(resolvedProp.default)}`
                  : resolvedType === "number" || resolvedType === "integer"
                    ? "0"
                    : "value"
              }
              className="font-mono ms-4"
            />
          )}
          {fieldState.error && (
            <div className="text-xs text-destructive ms-4">{fieldState.error.message}</div>
          )}
        </div>
      )}
    />
  );
}

type AlternativeSet = NonNullable<ReturnType<typeof schemaAlternativeOptions>>;

function schemaTypeDisplay(schema: MCPToolSchemaProperty): string {
  const alternatives = schemaAlternativeOptions(schema);
  if (alternatives) return alternatives.kind;
  if (schema.const !== undefined) return "const";
  if (Array.isArray(schema.type)) return schema.type.join("|");
  return resolveSchemaType(schema) ?? "any";
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parseStructuredValue(value: string): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function serializeStructuredValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function StructuredArgFieldWrapper({
  field,
  prop,
  rootSchema,
}: {
  field: { value: string; onChange: (v: string) => void; onBlur: () => void };
  prop: MCPToolSchemaProperty;
  rootSchema: MCPToolSchema;
}) {
  const parsed = React.useMemo(
    () => parseStructuredValue(field.value),
    [field.value],
  );

  const onChange = React.useCallback(
    (value: unknown) => {
      field.onChange(serializeStructuredValue(value));
    },
    [field],
  );

  return (
    <div className="ms-4">
      <ValueField
        value={parsed}
        onChange={onChange}
        onBlur={field.onBlur}
        schema={prop}
        rootSchema={rootSchema}
      />
    </div>
  );
}

function schemaProperties(
  schema: MCPToolSchemaProperty,
  rootSchema: MCPToolSchema,
): Record<string, MCPToolSchemaProperty> {
  const resolved = resolveSchemaPropertyRef(schema, rootSchema);
  return resolved.properties ?? {};
}

function alternativeDiscriminator(
  schema: MCPToolSchemaProperty,
  rootSchema: MCPToolSchema,
): { name: string; value: unknown; values: unknown[]; label: string } | null {
  const properties = schemaProperties(schema, rootSchema);
  const preferred = ["type", "operator", "kind", "name"];
  const entries = Object.entries(properties);
  const ordered = [
    ...preferred
      .map((name) => {
        const prop = properties[name];
        return prop ? ([name, prop] as const) : null;
      })
      .filter((entry): entry is readonly [string, MCPToolSchemaProperty] => entry !== null),
    ...entries.filter(([name]) => !preferred.includes(name)),
  ];

  for (const [name, prop] of ordered) {
    const resolved = resolveSchemaPropertyRef(prop, rootSchema);
    if (resolved.const !== undefined) {
      return {
        name,
        value: resolved.const,
        values: [resolved.const],
        label: `${name}: ${String(resolved.const)}`,
      };
    }
    if (resolved.enum && resolved.enum.length > 0) {
      const first = resolved.enum[0];
      if (first === undefined) continue;
      return {
        name,
        value: first,
        values: resolved.enum,
        label: `${name}: ${resolved.enum.map(String).join(" | ")}`,
      };
    }
  }

  return null;
}

function alternativeLabel(
  schema: MCPToolSchemaProperty,
  index: number,
  rootSchema: MCPToolSchema,
): string {
  if (typeof schema.title === "string" && schema.title.trim()) return schema.title;
  const discriminator = alternativeDiscriminator(schema, rootSchema);
  if (discriminator) return discriminator.label;
  if (typeof schema.description === "string" && schema.description.trim()) {
    return schema.description.length > 72
      ? `${schema.description.slice(0, 69)}...`
      : schema.description;
  }
  return `Option ${index + 1}`;
}

function alternativeMatchScore(
  schema: MCPToolSchemaProperty,
  value: unknown,
  rootSchema: MCPToolSchema,
): number {
  const resolved = resolveSchemaPropertyRef(schema, rootSchema);
  if (resolved.const !== undefined) return value === resolved.const ? 4 : 0;
  if (resolved.enum) return resolved.enum.some((item) => item === value) ? 3 : 0;

  const discriminator = alternativeDiscriminator(resolved, rootSchema);
  if (discriminator && isRecordValue(value)) {
    return discriminator.values.some((item) => item === value[discriminator.name])
      ? 5
      : 0;
  }

  const type = resolveSchemaType(resolved);
  if (type === "object" && isRecordValue(value)) return 1;
  if (type === "array" && Array.isArray(value)) return 1;
  if ((type === "string" || type === "number" || type === "boolean") && typeof value === type) {
    return 1;
  }
  return 0;
}

function selectedAlternativeIndex(
  options: MCPToolSchemaProperty[],
  value: unknown,
  rootSchema: MCPToolSchema,
): number | null {
  let bestIndex: number | null = null;
  let bestScore = 0;

  options.forEach((option, index) => {
    const score = alternativeMatchScore(option, value, rootSchema);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore > 1 ? bestIndex : null;
}

function defaultForAlternative(
  schema: MCPToolSchemaProperty,
  rootSchema: MCPToolSchema,
): unknown {
  const resolved = resolveSchemaPropertyRef(schema, rootSchema);
  if (resolved.default !== undefined) return resolved.default;
  if (resolved.const !== undefined) return resolved.const;

  const type = resolveSchemaType(resolved);
  if (type === "object") {
    const value: Record<string, unknown> = {};
    const discriminator = alternativeDiscriminator(resolved, rootSchema);
    if (discriminator) value[discriminator.name] = discriminator.value;
    for (const [name, prop] of Object.entries(resolved.properties ?? {})) {
      const child = resolveSchemaPropertyRef(prop, rootSchema);
      if (child.default !== undefined) value[name] = child.default;
      if (child.const !== undefined) value[name] = child.const;
    }
    return value;
  }
  return defaultForSchema(resolved, rootSchema);
}

function AlternativeField({
  value,
  onChange,
  onBlur,
  rootSchema,
  alternatives,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  onBlur: () => void;
  rootSchema: MCPToolSchema;
  alternatives: AlternativeSet;
}) {
  const matchedIndex = selectedAlternativeIndex(
    alternatives.options,
    value,
    rootSchema,
  );
  const [manualIndex, setManualIndex] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (matchedIndex != null) setManualIndex(null);
  }, [matchedIndex]);
  React.useEffect(() => {
    if (value === undefined || value === null) setManualIndex(null);
  }, [value]);

  const selectedIndex = matchedIndex ?? manualIndex;
  const selectedSchema =
    selectedIndex == null ? null : alternatives.options[selectedIndex];

  return (
    <div className="space-y-2">
      <select
        value={selectedIndex == null ? "" : String(selectedIndex)}
        onChange={(event) => {
          const index = event.target.value === "" ? null : Number(event.target.value);
          if (index == null) {
            setManualIndex(null);
            onChange(undefined);
            return;
          }
          setManualIndex(index);
          const option = alternatives.options[index];
          if (option) onChange(defaultForAlternative(option, rootSchema));
        }}
        onBlur={onBlur}
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs font-mono text-foreground outline-none transition-colors focus-visible:border-ring"
      >
        <option value="">Select {alternatives.kind}</option>
        {alternatives.options.map((option, index) => (
          <option key={index} value={index}>
            {alternativeLabel(option, index, rootSchema)}
          </option>
        ))}
      </select>
      {selectedSchema && (
        <ValueField
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          schema={selectedSchema}
          rootSchema={rootSchema}
        />
      )}
    </div>
  );
}

function isComplexSchema(
  schema: MCPToolSchemaProperty,
  rootSchema: MCPToolSchema,
): boolean {
  const resolved = resolveSchemaPropertyRef(schema, rootSchema);
  const type = resolveSchemaType(resolved);
  return Boolean(
    schemaAlternativeOptions(resolved) ||
      (type === "object" && resolved.properties) ||
      type === "array",
  );
}

/* ------------------------------------------------------------------ */
/* Object sub-fields                                                   */
/* ------------------------------------------------------------------ */

function parseObjectValue(value: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const obj = JSON.parse(value);
    return typeof obj === "object" && obj !== null && !Array.isArray(obj)
      ? (obj as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function ObjectArgFieldWrapper({
  field,
  prop,
  rootSchema,
}: {
  field: { value: string; onChange: (v: string) => void; onBlur: () => void };
  prop: MCPToolSchemaProperty;
  rootSchema: MCPToolSchema;
}) {
  const parsed = React.useMemo(
    () => parseObjectValue(field.value),
    [field.value],
  );

  const onChange = React.useCallback(
    (obj: Record<string, unknown>) => {
      field.onChange(
        Object.keys(obj).length > 0 ? JSON.stringify(obj) : "",
      );
    },
    [field],
  );

  return (
    <ObjectFields
      value={parsed}
      onChange={onChange}
      onBlur={field.onBlur}
      properties={prop.properties!}
      requiredSet={new Set(prop.required ?? [])}
      rootSchema={rootSchema}
    />
  );
}

function ObjectFields({
  value,
  onChange,
  onBlur,
  properties,
  requiredSet,
  rootSchema,
}: {
  value: Record<string, unknown>;
  onChange: (obj: Record<string, unknown>) => void;
  onBlur: () => void;
  properties: Record<string, MCPToolSchemaProperty>;
  requiredSet: Set<string>;
  rootSchema: MCPToolSchema;
}) {
  const handleChange = React.useCallback(
    (name: string, subValue: unknown) => {
      const next = { ...value };
      if (subValue === undefined) {
        delete next[name];
      } else {
        next[name] = subValue;
      }
      onChange(next);
    },
    [value, onChange],
  );

  return (
    <div className="space-y-3 rounded-md border border-border/40 bg-black/10 p-3 ms-4">
      {Object.entries(properties).map(([name, prop]) => (
        <ObjectPropertyField
          key={name}
          name={name}
          prop={prop}
          required={requiredSet.has(name)}
          value={value[name]}
          onChange={(v) => handleChange(name, v)}
          onBlur={onBlur}
          rootSchema={rootSchema}
        />
      ))}
    </div>
  );
}

function parseArrayValue(value: string): unknown[] {
  if (!value) return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function defaultForSchema(
  schema: MCPToolSchemaProperty,
  rootSchema: MCPToolSchema,
): unknown {
  const resolved = resolveSchemaPropertyRef(schema, rootSchema);
  if (resolved.default !== undefined) return resolved.default;
  if (resolved.const !== undefined) return resolved.const;
  if (schemaAlternativeOptions(resolved)) return {};
  const type = resolveSchemaType(resolved);
  switch (type) {
    case "boolean":
      return false;
    case "number":
    case "integer":
      return 0;
    case "object":
      return {};
    case "array":
      return [];
    default:
      return "";
  }
}

function ArrayArgFieldWrapper({
  field,
  prop,
  rootSchema,
}: {
  field: { value: string; onChange: (v: string) => void; onBlur: () => void };
  prop: MCPToolSchemaProperty;
  rootSchema: MCPToolSchema;
}) {
  const parsed = React.useMemo(
    () => parseArrayValue(field.value),
    [field.value],
  );

  const onChange = React.useCallback(
    (arr: unknown[]) => {
      field.onChange(arr.length > 0 ? JSON.stringify(arr) : "");
    },
    [field],
  );

  return (
    <ArrayFields
      value={parsed}
      onChange={onChange}
      onBlur={field.onBlur}
      itemSchema={prop.items as MCPToolSchemaProperty}
      rootSchema={rootSchema}
    />
  );
}

function ArrayFields({
  value,
  onChange,
  onBlur,
  itemSchema,
  rootSchema,
}: {
  value: unknown[];
  onChange: (arr: unknown[]) => void;
  onBlur: () => void;
  itemSchema: MCPToolSchemaProperty;
  rootSchema: MCPToolSchema;
}) {
  const handleItemChange = React.useCallback(
    (index: number, itemValue: unknown) => {
      const next = [...value];
      next[index] = itemValue;
      onChange(next);
    },
    [value, onChange],
  );

  const handleRemove = React.useCallback(
    (index: number) => {
      onChange(value.filter((_, i) => i !== index));
    },
    [value, onChange],
  );

  const handleAdd = React.useCallback(() => {
    onChange([...value, defaultForSchema(itemSchema, rootSchema)]);
  }, [value, onChange, itemSchema, rootSchema]);

  const isComplex = isComplexSchema(itemSchema, rootSchema);

  return (
    <div className="space-y-2 rounded-md border border-border/40 bg-black/10 p-3 ms-4">
      {value.map((item, index) => (
        <div
          key={index}
          className={cn(
            "group/item",
            isComplex ? "space-y-1" : "flex items-center gap-2",
          )}
        >
          {isComplex ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground/60 font-mono">
                  [{index}]
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  className="opacity-0 group-hover/item:opacity-100 rounded p-0.5 text-muted-foreground hover:text-destructive transition-all cursor-pointer"
                >
                  <X className="size-3" />
                </button>
              </div>
              <ValueField
                value={item}
                onChange={(v) => handleItemChange(index, v)}
                onBlur={onBlur}
                schema={itemSchema}
                rootSchema={rootSchema}
              />
            </>
          ) : (
            <>
              <span className="text-[10px] text-muted-foreground/60 font-mono shrink-0 w-5 text-right">
                {index}
              </span>
              <div className="flex-1 min-w-0">
                <ValueField
                  value={item}
                  onChange={(v) => handleItemChange(index, v)}
                  onBlur={onBlur}
                  schema={itemSchema}
                  rootSchema={rootSchema}
                />
              </div>
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="opacity-0 group-hover/item:opacity-100 rounded p-0.5 text-muted-foreground hover:text-destructive transition-all cursor-pointer shrink-0"
              >
                <X className="size-3" />
              </button>
            </>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={handleAdd}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <Plus className="size-3" />
        Add item
      </button>
    </div>
  );
}

function ValueField({
  value,
  onChange,
  onBlur,
  schema,
  rootSchema,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  onBlur: () => void;
  schema: MCPToolSchemaProperty;
  rootSchema: MCPToolSchema;
}) {
  const resolvedSchema = resolveSchemaPropertyRef(schema, rootSchema);
  const alternatives = schemaAlternativeOptions(resolvedSchema);
  const resolvedType = resolveSchemaType(resolvedSchema);

  const stringValue =
    value === undefined || value === null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

  if (alternatives) {
    return (
      <AlternativeField
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        rootSchema={rootSchema}
        alternatives={alternatives}
      />
    );
  }

  if (resolvedSchema.const !== undefined) {
    const selected = value === resolvedSchema.const;
    return (
      <button
        type="button"
        onClick={() => onChange(resolvedSchema.const)}
        className={cn(
          "rounded-md border px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer",
          selected
            ? "border-success/40 bg-success/10 text-success"
            : "border-border bg-black/25 text-muted-foreground hover:bg-accent/40",
        )}
      >
        {String(resolvedSchema.const)}
      </button>
    );
  }

  if (resolvedSchema.enum) {
    const nullable = Array.isArray(resolvedSchema.type) && resolvedSchema.type.includes("null");
    return (
      <div className="flex flex-wrap gap-1">
        {resolvedSchema.enum.map((opt) => {
          const selected = stringValue === String(opt);
          return (
            <button
              key={String(opt)}
              type="button"
              onClick={() => onChange(selected && nullable ? null : opt)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer",
                selected
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-border bg-black/25 text-muted-foreground hover:bg-accent/40",
              )}
            >
              {String(opt)}
            </button>
          );
        })}
      </div>
    );
  }

  if (resolvedType === "boolean") {
    const nullable = Array.isArray(resolvedSchema.type) && resolvedSchema.type.includes("null");
    return (
      <div className="flex gap-1">
        {[true, false].map((opt) => {
          const selected = value === opt;
          return (
            <button
              key={String(opt)}
              type="button"
              onClick={() => onChange(selected && nullable ? null : opt)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer",
                selected
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-border bg-black/25 text-muted-foreground hover:bg-accent/40",
              )}
            >
              {String(opt)}
            </button>
          );
        })}
      </div>
    );
  }

  if (resolvedType === "object" && resolvedSchema.properties) {
    return (
      <ObjectFields
        value={
          typeof value === "object" &&
            value !== null &&
            !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {}
        }
        onChange={onChange as (obj: Record<string, unknown>) => void}
        onBlur={onBlur}
        properties={resolvedSchema.properties}
        requiredSet={new Set(resolvedSchema.required ?? [])}
        rootSchema={rootSchema}
      />
    );
  }

  if (
    resolvedType === "array" &&
    resolvedSchema.items &&
    typeof resolvedSchema.items === "object" &&
    !Array.isArray(resolvedSchema.items)
  ) {
    return (
      <ArrayFields
        value={Array.isArray(value) ? (value as unknown[]) : []}
        onChange={onChange as (arr: unknown[]) => void}
        onBlur={onBlur}
        itemSchema={resolvedSchema.items as MCPToolSchemaProperty}
        rootSchema={rootSchema}
      />
    );
  }

  if (resolvedType === "object" || resolvedType === "array") {
    return (
      <JsonSubField
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={resolvedType === "array" ? "[]" : "{}"}
      />
    );
  }

  return (
    <Input
      type={
        resolvedType === "number" || resolvedType === "integer"
          ? "number"
          : "text"
      }
      value={stringValue}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "") {
          onChange(undefined);
        } else if (
          resolvedType === "number" ||
          resolvedType === "integer"
        ) {
          const n = Number(v);
          onChange(Number.isNaN(n) ? undefined : n);
        } else {
          onChange(v);
        }
      }}
      onBlur={onBlur}
      placeholder={
        resolvedSchema.default !== undefined
          ? `default: ${String(resolvedSchema.default)}`
          : resolvedType === "number" || resolvedType === "integer"
            ? "0"
            : "value"
      }
      className="font-mono text-xs"
    />
  );
}

function ObjectPropertyField({
  name,
  prop,
  required,
  value,
  onChange,
  onBlur,
  rootSchema,
}: {
  name: string;
  prop: MCPToolSchemaProperty;
  required: boolean;
  value: unknown;
  onChange: (v: unknown) => void;
  onBlur: () => void;
  rootSchema: MCPToolSchema;
}) {
  const resolvedProp = resolveSchemaPropertyRef(prop, rootSchema);
  const typeDisplay = schemaTypeDisplay(resolvedProp);

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-2">
        <span className="font-mono normal-case text-foreground text-xs">
          {name}
        </span>
        <Badge variant="muted" className="font-mono text-[10px] px-1.5 py-0">
          {typeDisplay}
        </Badge>
        {required && (
          <span className="inline-flex items-center text-warning">
            <Asterisk className="size-3" />
            <span className="text-[10px] uppercase tracking-wider">
              required
            </span>
          </span>
        )}
      </Label>
      {resolvedProp.description && (
        <MarkdownDescription className="text-muted-foreground/80 text-xs">{resolvedProp.description}</MarkdownDescription>
      )}
      <ValueField
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        schema={resolvedProp}
        rootSchema={rootSchema}
      />
    </div>
  );
}

function JsonSubField({
  value,
  onChange,
  onBlur,
  placeholder,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  onBlur: () => void;
  placeholder: string;
}) {
  const canonical = React.useMemo(
    () =>
      value !== undefined && value !== null
        ? JSON.stringify(value, null, 2)
        : "",
    [value],
  );

  const [text, setText] = React.useState(canonical);
  const focusedRef = React.useRef(false);

  React.useEffect(() => {
    if (!focusedRef.current) setText(canonical);
  }, [canonical]);

  return (
    <Textarea
      value={text}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        setText(canonical);
        onBlur();
      }}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === "") {
          onChange(undefined);
        } else {
          try {
            onChange(JSON.parse(t));
          } catch {
            // Don't propagate until valid JSON
          }
        }
      }}
      placeholder={placeholder}
      rows={3}
      className="text-xs font-mono"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Result rendering                                                    */
/* ------------------------------------------------------------------ */

function ToolResultView({
  state,
  serverName,
  toolInput,
}: {
  state: CallState;
  serverName: string;
  toolInput?: Record<string, unknown>;
}) {
  const errorMsg = state.error ?? (state.activity?.outcome === "error" ? state.activity.error : null);
  if (errorMsg) {
    return <ErrorMessage error={errorMsg} errorResponse={state.errorResponse} />;
  }
  if (!state.activity?.result) {
    return (
      <div className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
        Call the tool to see a response.
      </div>
    );
  }
  const r = state.activity.result;
  return (
    <div className="space-y-3">
      {r.content.map((block, i) => (
        <ContentBlockView
          key={i}
          block={block}
          serverName={serverName}
          toolInput={toolInput}
          toolResult={r}
        />
      ))}
      {r.structuredContent !== undefined && (
        <CodeBlock language="application/json" caption="structuredContent">
          {JSON.stringify(r.structuredContent, null, 2)}
        </CodeBlock>
      )}
    </div>
  );
}

function ContentBlockView({
  block,
  serverName,
  toolInput,
  toolResult,
}: {
  block: ToolResult["content"][number];
  serverName: string;
  toolInput?: Record<string, unknown>;
  toolResult: ToolResult;
}) {
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
    // An embedded `ui://` (or HTML/URI-list) resource is a classic mcp-ui app:
    // render it interactively rather than dumping its source.
    const appPayload =
      isUiResourceUri(inner.uri) || inner.mimeType
        ? appPayloadFromContent(inner)
        : null;
    if (appPayload) {
      return (
        <McpAppFrame
          serverName={serverName}
          kind={appPayload.kind}
          html={appPayload.html}
          url={appPayload.url}
          meta={appPayload.meta}
          toolInput={toolInput}
          toolResult={toolResult}
          title={inner.uri}
        />
      );
    }
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
