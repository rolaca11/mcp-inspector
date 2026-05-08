import * as React from "react";
import { Plus } from "lucide-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EditableJsonBlock } from "@/components/editable-json-block";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/data/api";
import {
  useAddServerStore,
  ADD_SERVER_DEFAULTS,
  type AddServerFormValues,
} from "@/stores/add-server-store";

/* ------------------------------------------------------------------ */
/* Zod schema                                                          */
/* ------------------------------------------------------------------ */

const formSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    mode: z.enum(["stdio", "http"]),
    command: z.string(),
    args: z.string().refine(
      (v) => {
        if (!v.trim()) return true;
        try { return Array.isArray(JSON.parse(v)); } catch { return false; }
      },
      { message: "Must be a JSON array" },
    ),
    env: z.string().refine(
      (v) => {
        if (!v.trim()) return true;
        try {
          const p = JSON.parse(v);
          return typeof p === "object" && p !== null && !Array.isArray(p);
        } catch { return false; }
      },
      { message: "Must be a JSON object" },
    ),
    cwd: z.string(),
    url: z.string(),
    httpType: z.string(),
    headers: z.string().refine(
      (v) => {
        if (!v.trim()) return true;
        try {
          const p = JSON.parse(v);
          return typeof p === "object" && p !== null && !Array.isArray(p);
        } catch { return false; }
      },
      { message: "Must be a JSON object" },
    ),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "stdio" && !data.command.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Command is required", path: ["command"] });
    }
    if (data.mode === "http" && !data.url.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "URL is required", path: ["url"] });
    }
  });

/* ------------------------------------------------------------------ */
/* Form ↔ JSON conversion                                             */
/* ------------------------------------------------------------------ */

function formToConfig(f: AddServerFormValues): Record<string, unknown> {
  if (f.mode === "stdio") {
    const cfg: Record<string, unknown> = { command: f.command.trim() };
    if (f.args.trim()) try { cfg.args = JSON.parse(f.args.trim()); } catch { /* skip */ }
    if (f.env.trim()) try { cfg.env = JSON.parse(f.env.trim()); } catch { /* skip */ }
    if (f.cwd.trim()) cfg.cwd = f.cwd.trim();
    return cfg;
  }
  const cfg: Record<string, unknown> = { url: f.url.trim() };
  if (f.httpType !== "http") cfg.type = f.httpType;
  if (f.headers.trim()) try { cfg.headers = JSON.parse(f.headers.trim()); } catch { /* skip */ }
  return cfg;
}

function formToJson(f: AddServerFormValues): string {
  const entry = formToConfig(f);
  const key = f.name.trim() || "<name>";
  return JSON.stringify({ mcpServers: { [key]: entry } }, null, 2);
}

function jsonToForm(text: string): AddServerFormValues | null {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const mcpServers = (parsed as Record<string, unknown>).mcpServers;
  if (typeof mcpServers !== "object" || mcpServers === null || Array.isArray(mcpServers)) return null;
  const entries = Object.entries(mcpServers as Record<string, unknown>);
  if (entries.length !== 1) return null;
  const [name, value] = entries[0]!;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;

  const f: AddServerFormValues = { ...ADD_SERVER_DEFAULTS, name };

  if (typeof v.command === "string") {
    f.mode = "stdio";
    f.command = v.command;
    if (v.args !== undefined) f.args = JSON.stringify(v.args);
    if (v.env !== undefined) f.env = JSON.stringify(v.env, null, 2);
    if (typeof v.cwd === "string") f.cwd = v.cwd;
  } else if (typeof v.url === "string") {
    f.mode = "http";
    f.url = v.url;
    if (typeof v.type === "string" && ["http", "sse", "streamable-http"].includes(v.type)) {
      f.httpType = v.type;
    }
    if (v.headers !== undefined) f.headers = JSON.stringify(v.headers, null, 2);
  } else {
    return null;
  }
  return f;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

interface AddServerDialogProps {
  onAdded: () => void;
}

export function AddServerDialog({ onAdded }: AddServerDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [jsonError, setJsonError] = React.useState<string | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const storeValues = useAddServerStore((s) => s.values);
  const storeSet = useAddServerStore((s) => s.set);
  const storeSetAll = useAddServerStore((s) => s.setAll);
  const storeReset = useAddServerStore((s) => s.reset);
  const skipSyncRef = React.useRef(false);

  const form = useForm<AddServerFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: storeValues,
    mode: "onChange",
  });

  const { control, watch, reset, formState, handleSubmit } = form;

  // Sync form → store
  React.useEffect(() => {
    const sub = watch((values, { name: field }) => {
      if (skipSyncRef.current) return;
      if (field && values[field as keyof AddServerFormValues] !== undefined) {
        storeSet({ [field]: values[field as keyof AddServerFormValues] } as Partial<AddServerFormValues>);
      }
    });
    return () => sub.unsubscribe();
  }, [watch, storeSet]);

  const watched = watch();
  const jsonText = React.useMemo(() => formToJson(watched), [watched]);

  // JSON → form + store
  const onJsonChange = React.useCallback(
    (text: string) => {
      const parsed = jsonToForm(text);
      if (parsed) {
        setJsonError(null);
        skipSyncRef.current = true;
        reset(parsed);
        storeSetAll(parsed);
        skipSyncRef.current = false;
      } else {
        try {
          JSON.parse(text);
          setJsonError("Expected { mcpServers: { <name>: { command | url, ... } } }");
        } catch {
          setJsonError("Invalid JSON");
        }
      }
    },
    [reset, storeSetAll],
  );

  function handleOpen(v: boolean) {
    setOpen(v);
    if (v) {
      reset(storeValues);
    } else {
      storeReset();
      reset(ADD_SERVER_DEFAULTS);
      setJsonError(null);
      setSubmitError(null);
    }
  }

  async function onSubmit(data: AddServerFormValues) {
    setSubmitError(null);
    const config = formToConfig(data);
    setSubmitting(true);
    try {
      await api.configAddServer(data.name.trim(), config);
      setOpen(false);
      storeReset();
      reset(ADD_SERVER_DEFAULTS);
      setJsonError(null);
      onAdded();
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const mode = watch("mode");

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus />
          Add Server
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>Add Server</DialogTitle>
            <DialogDescription>
              Add a server to the inspector config. Use the form or edit the JSON directly.
            </DialogDescription>
          </DialogHeader>

          <div className="grid md:grid-cols-2 gap-6 py-4 min-h-[24rem]">
            {/* Left — structured form */}
            <div className="flex flex-col gap-4 overflow-y-auto">
              <Controller
                name="name"
                control={control}
                render={({ field, fieldState }) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor="server-name">Name</Label>
                    <Input
                      id="server-name"
                      placeholder="my-server"
                      {...field}
                      autoFocus
                    />
                    {fieldState.error && (
                      <p className="text-xs text-destructive">{fieldState.error.message}</p>
                    )}
                  </div>
                )}
              />

              <Controller
                name="mode"
                control={control}
                render={({ field }) => (
                  <div className="grid gap-1.5">
                    <Label>Transport</Label>
                    <div className="flex gap-1">
                      {(["stdio", "http"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => field.onChange(m)}
                          className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                            field.value === m
                              ? "border-ring bg-accent text-accent-foreground"
                              : "border-border/60 bg-card/40 text-muted-foreground hover:bg-accent/50"
                          }`}
                        >
                          {m === "http" ? "HTTP" : m}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              />

              {mode === "stdio" ? (
                <>
                  <Controller
                    name="command"
                    control={control}
                    render={({ field, fieldState }) => (
                      <div className="grid gap-1.5">
                        <Label htmlFor="server-command">Command</Label>
                        <Input id="server-command" placeholder="npx" {...field} />
                        {fieldState.error && (
                          <p className="text-xs text-destructive">{fieldState.error.message}</p>
                        )}
                      </div>
                    )}
                  />
                  <Controller
                    name="args"
                    control={control}
                    render={({ field, fieldState }) => (
                      <div className="grid gap-1.5">
                        <Label htmlFor="server-args">
                          Args{" "}
                          <span className="text-muted-foreground/60 font-normal">(JSON array)</span>
                        </Label>
                        <Input
                          id="server-args"
                          placeholder='["-y", "@modelcontextprotocol/server-everything"]'
                          className="font-mono text-xs"
                          {...field}
                        />
                        {fieldState.error && (
                          <p className="text-xs text-destructive">{fieldState.error.message}</p>
                        )}
                      </div>
                    )}
                  />
                  <Controller
                    name="env"
                    control={control}
                    render={({ field, fieldState }) => (
                      <div className="grid gap-1.5">
                        <Label htmlFor="server-env">
                          Env{" "}
                          <span className="text-muted-foreground/60 font-normal">(JSON object, optional)</span>
                        </Label>
                        <Input
                          id="server-env"
                          placeholder='{"DEBUG": "1"}'
                          className="font-mono text-xs"
                          {...field}
                        />
                        {fieldState.error && (
                          <p className="text-xs text-destructive">{fieldState.error.message}</p>
                        )}
                      </div>
                    )}
                  />
                  <Controller
                    name="cwd"
                    control={control}
                    render={({ field }) => (
                      <div className="grid gap-1.5">
                        <Label htmlFor="server-cwd">
                          Working directory{" "}
                          <span className="text-muted-foreground/60 font-normal">(optional)</span>
                        </Label>
                        <Input
                          id="server-cwd"
                          placeholder="/path/to/project"
                          className="font-mono text-xs"
                          {...field}
                        />
                      </div>
                    )}
                  />
                </>
              ) : (
                <>
                  <Controller
                    name="url"
                    control={control}
                    render={({ field, fieldState }) => (
                      <div className="grid gap-1.5">
                        <Label htmlFor="server-url">URL</Label>
                        <Input
                          id="server-url"
                          placeholder="https://example.com/mcp"
                          className="font-mono text-xs"
                          {...field}
                        />
                        {fieldState.error && (
                          <p className="text-xs text-destructive">{fieldState.error.message}</p>
                        )}
                      </div>
                    )}
                  />
                  <Controller
                    name="httpType"
                    control={control}
                    render={({ field }) => (
                      <div className="grid gap-1.5">
                        <Label>Type</Label>
                        <div className="flex gap-1">
                          {(["http", "sse", "streamable-http"] as const).map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => field.onChange(t)}
                              className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                                field.value === t
                                  ? "border-ring bg-accent text-accent-foreground"
                                  : "border-border/60 bg-card/40 text-muted-foreground hover:bg-accent/50"
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  />
                  <Controller
                    name="headers"
                    control={control}
                    render={({ field, fieldState }) => (
                      <div className="grid gap-1.5">
                        <Label htmlFor="server-headers">
                          Headers{" "}
                          <span className="text-muted-foreground/60 font-normal">(JSON object, optional)</span>
                        </Label>
                        <Input
                          id="server-headers"
                          placeholder='{"Authorization": "Bearer ..."}'
                          className="font-mono text-xs"
                          {...field}
                        />
                        {fieldState.error && (
                          <p className="text-xs text-destructive">{fieldState.error.message}</p>
                        )}
                      </div>
                    )}
                  />
                </>
              )}
            </div>

            {/* Right — live JSON editor */}
            <EditableJsonBlock
              value={jsonText}
              onChange={onJsonChange}
              error={jsonError}
              label="mcp.json"
              className="min-h-0"
            />
          </div>

          {submitError && (
            <p className="text-sm text-destructive pb-4">{submitError}</p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={submitting || !formState.isValid || !!jsonError}>
              {submitting ? "Adding..." : "Add Server"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
