import * as React from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquareMore,
} from "lucide-react";

import {
  describeElicitationForm,
  plural,
  validateElicitationFormContent,
  validateElicitationUrl,
  type ElicitationAction,
  type ElicitationContentValue,
  type ElicitationUrlParams,
  type NormalizedElicitationField,
  type PendingElicitation,
} from "@rolaca11/mcp-inspector-core/elicitation";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  useElicitationStore,
  type ElicitationFormDraft,
  type ElicitationFormRawValue,
} from "@/stores/elicitation-store";

const PILL_LIMIT = 5;

const pillClass = (selected: boolean) =>
  cn(
    "rounded-md border px-3 py-1.5 text-sm font-mono transition-colors cursor-pointer",
    selected
      ? "border-success/40 bg-success/10 text-success"
      : "border-border bg-black/25 text-muted-foreground hover:bg-accent/40",
  );

function initialDraft(fields: NormalizedElicitationField[]): ElicitationFormDraft {
  const values: Record<string, ElicitationFormRawValue> = {};
  for (const field of fields) {
    const def = field.default;
    if (def === undefined) {
      values[field.name] = field.kind === "multi-enum" ? [] : undefined;
    } else if (typeof def === "number") {
      values[field.name] = String(def);
    } else {
      values[field.name] = Array.isArray(def) ? [...def] : def;
    }
  }
  return { values, touched: {}, submitted: false };
}

function rawContent(
  fields: NormalizedElicitationField[],
  values: Record<string, ElicitationFormRawValue>,
): Record<string, ElicitationContentValue> {
  const out: Record<string, ElicitationContentValue> = {};
  for (const field of fields) {
    const raw = values[field.name];
    const numeric = (field.kind === "number" || field.kind === "integer") && typeof raw === "string";
    if (raw === undefined || raw === "" || (numeric && raw.trim() === "") || (Array.isArray(raw) && raw.length === 0)) {
      continue;
    }
    out[field.name] = numeric ? Number(raw) : raw;
  }
  return out;
}

function fieldHint(field: NormalizedElicitationField): string | null {
  const parts: string[] = [];
  if (field.format === "date") parts.push("YYYY-MM-DD");
  if (field.format === "date-time") parts.push("RFC 3339 with timezone, e.g. 2026-01-31T09:30:00Z");
  if (field.minLength !== undefined) parts.push(`at least ${plural(field.minLength, "character")}`);
  if (field.maxLength !== undefined) parts.push(`at most ${plural(field.maxLength, "character")}`);
  if (field.minimum !== undefined) parts.push(`min ${field.minimum}`);
  if (field.maximum !== undefined) parts.push(`max ${field.maximum}`);
  if (field.minItems !== undefined) parts.push(`pick at least ${field.minItems}`);
  if (field.maxItems !== undefined) parts.push(`pick at most ${field.maxItems}`);
  return parts.length ? parts.join(" · ") : null;
}

function kindLabel(field: NormalizedElicitationField): string {
  if (field.kind === "single-enum") return "select";
  if (field.kind === "multi-enum") return "multi-select";
  if (field.format) return `string · ${field.format}`;
  return field.kind;
}

const STRING_INPUT: Record<string, { type: string; placeholder: string }> = {
  email: { type: "email", placeholder: "name@example.com" },
  uri: { type: "url", placeholder: "https://" },
  date: { type: "date", placeholder: "value" },
  "date-time": { type: "text", placeholder: "2026-01-31T09:30:00Z" },
};

/* ------------------------------------------------------------------ */
/* Inline panel                                                        */
/* ------------------------------------------------------------------ */

export function ElicitationPanel({
  serverName,
  className,
}: {
  serverName: string;
  className?: string;
}) {
  const pending = useElicitationStore((s) => s.pending);
  const drafts = useElicitationStore((s) => s.drafts);
  const setDraft = useElicitationStore((s) => s.setDraft);

  const queue = React.useMemo(
    () => pending.filter((p) => p.serverName === serverName),
    [pending, serverName],
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const panelRef = React.useRef<HTMLElement>(null);

  const active = queue.find((p) => p.id === selectedId) ?? queue[0] ?? null;
  const index = active ? queue.indexOf(active) : -1;

  React.useEffect(() => {
    if (active?.id) {
      panelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    }
  }, [active?.id]);

  if (!active) return null;

  const select = (offset: number) => {
    const next = queue[(index + offset + queue.length) % queue.length];
    if (next) setSelectedId(next.id);
  };

  return (
    <section
      ref={panelRef}
      data-testid="elicitation-panel"
      aria-label="Server elicitation request"
      className={cn("rounded-md border border-info/30 bg-card/60", className)}
    >
      <ElicitationBody
        key={active.id}
        elicitation={active}
        position={queue.length > 1 ? { index, total: queue.length, select } : null}
        draft={drafts[active.id]}
        onDraftChange={(draft) => setDraft(active.id, draft)}
      />
    </section>
  );
}

interface QueuePosition {
  index: number;
  total: number;
  select(offset: number): void;
}

function ElicitationBody({
  elicitation,
  position,
  draft,
  onDraftChange,
}: {
  elicitation: PendingElicitation;
  position: QueuePosition | null;
  draft: ElicitationFormDraft | undefined;
  onDraftChange(draft: ElicitationFormDraft): void;
}) {
  const { params } = elicitation;
  const respond = useElicitationStore((s) => s.respond);
  const submitting = useElicitationStore((s) => s.submittingId === elicitation.id);
  const submitError = useElicitationStore((s) =>
    s.submitErrorId === elicitation.id ? s.submitError : null,
  );

  const fields = React.useMemo(
    () => (params.mode === "form" ? describeElicitationForm(params.requestedSchema) : []),
    [params],
  );
  const initial = React.useMemo(() => initialDraft(fields), [fields]);
  const current = draft ?? initial;
  const validation = React.useMemo(
    () =>
      params.mode === "form"
        ? validateElicitationFormContent(params.requestedSchema, rawContent(fields, current.values))
        : null,
    [params, fields, current.values],
  );
  const canAccept = !submitting && (validation === null || validation.ok);

  const send = (action: ElicitationAction) => {
    if (submitting) return;
    if (action === "accept" && validation && !validation.ok) {
      onDraftChange({ ...current, submitted: true });
      return;
    }
    void respond(
      elicitation.id,
      action,
      action === "accept" && validation?.ok ? validation.content : undefined,
    );
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    send("accept");
  };

  return (
    <div onKeyDown={onKeyDown}>
      <div className="space-y-2 border-b border-border/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <MessageSquareMore className="size-4 shrink-0 text-info" />
          <h3 className="text-sm font-semibold text-foreground">
            {params.mode === "url" ? "The server wants you to open a link" : "The server is asking for input"}
          </h3>
          <Badge variant="info">{params.mode === "url" ? "URL elicitation" : "Form elicitation"}</Badge>
          {position && (
            <span className="ml-auto inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-card/50 font-mono text-xs text-muted-foreground">
              <button
                type="button"
                aria-label="Previous elicitation"
                className="cursor-pointer rounded-l-md px-1 py-0.5 hover:bg-accent hover:text-foreground"
                onClick={() => position.select(-1)}
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <span className="px-1 tabular-nums">
                {position.index + 1} of {position.total}
              </span>
              <button
                type="button"
                aria-label="Next elicitation"
                className="cursor-pointer rounded-r-md px-1 py-0.5 hover:bg-accent hover:text-foreground"
                onClick={() => position.select(1)}
              >
                <ChevronRight className="size-3.5" />
              </button>
            </span>
          )}
        </div>
        {params.message ? (
          <p className="whitespace-pre-wrap break-words text-sm text-foreground/85">{params.message}</p>
        ) : (
          <p className="text-sm italic text-muted-foreground">No message provided.</p>
        )}
      </div>

      <div className="space-y-5 px-5 py-5">
        {params.mode === "form" ? (
          <div className="max-w-xl">
            <ElicitationForm
              fields={fields}
              draft={current}
              errors={validation && !validation.ok ? validation.errors : {}}
              onChange={onDraftChange}
            />
          </div>
        ) : (
          <UrlElicitationDetails params={params} serverName={elicitation.serverName} />
        )}

        <InspectJson
          params={params}
          preview={
            params.mode === "form"
              ? {
                  action: "accept",
                  content: validation?.ok ? validation.content : rawContent(fields, current.values),
                }
              : { action: "accept" }
          }
        />
      </div>

      <div className="space-y-3 border-t border-border/60 px-5 py-3.5">
        {submitError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span className="break-words">{submitError}</span>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {params.mode === "form" && (
            <span className="mr-auto hidden font-mono text-[11px] text-muted-foreground/70 sm:inline">
              ⌘/Ctrl+Enter to accept
            </span>
          )}
          <Button type="button" variant="ghost" disabled={submitting} onClick={() => send("cancel")}>
            Cancel
          </Button>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => send("decline")}>
            Decline
          </Button>
          <Button type="button" variant="success" disabled={!canAccept} onClick={() => send("accept")}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form mode                                                           */
/* ------------------------------------------------------------------ */

function ElicitationForm({
  fields,
  draft,
  errors,
  onChange,
}: {
  fields: NormalizedElicitationField[];
  draft: ElicitationFormDraft;
  errors: Record<string, string>;
  onChange(draft: ElicitationFormDraft): void;
}) {
  if (fields.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
        The server asked for no fields. Accept to confirm.
      </div>
    );
  }

  const setValue = (name: string, value: ElicitationFormRawValue, touch = true) =>
    onChange({
      ...draft,
      values: { ...draft.values, [name]: value },
      touched: touch ? { ...draft.touched, [name]: true } : draft.touched,
    });
  const touch = (name: string) =>
    draft.touched[name] ? undefined : onChange({ ...draft, touched: { ...draft.touched, [name]: true } });

  return (
    <div className="space-y-5">
      {fields.map((field) => {
        const showError = draft.touched[field.name] || draft.submitted;
        return (
          <ElicitationField
            key={field.name}
            field={field}
            value={draft.values[field.name]}
            error={showError ? errors[field.name] : undefined}
            onChange={(value, touchNow) => setValue(field.name, value, touchNow)}
            onBlur={() => touch(field.name)}
          />
        );
      })}
    </div>
  );
}

function ElicitationField({
  field,
  value,
  error,
  onChange,
  onBlur,
}: {
  field: NormalizedElicitationField;
  value: ElicitationFormRawValue;
  error?: string;
  onChange(value: ElicitationFormRawValue, touch?: boolean): void;
  onBlur(): void;
}) {
  const id = `elicit-field-${field.name}`;
  const hint = fieldHint(field);
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-2" data-field={field.name}>
      <Label id={`${id}-label`} htmlFor={id} className="flex flex-wrap items-center gap-2.5">
        <span className="font-mono normal-case text-foreground">{field.label}</span>
        {field.label !== field.name && (
          <span className="font-mono text-muted-foreground/60">{field.name}</span>
        )}
        <Badge variant="muted" className="font-mono">
          {kindLabel(field)}
        </Badge>
        {field.required && <span className="text-destructive">required</span>}
      </Label>
      {field.description && (
        <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{field.description}</p>
      )}
      <FieldControl
        id={id}
        field={field}
        value={value}
        invalid={!!error}
        describedBy={error ? errorId : undefined}
        onChange={onChange}
        onBlur={onBlur}
      />
      {hint && <p className="font-mono text-[11px] text-muted-foreground/70">{hint}</p>}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function FieldControl({
  id,
  field,
  value,
  invalid,
  describedBy,
  onChange,
  onBlur,
}: {
  id: string;
  field: NormalizedElicitationField;
  value: ElicitationFormRawValue;
  invalid: boolean;
  describedBy?: string;
  onChange(value: ElicitationFormRawValue, touch?: boolean): void;
  onBlur(): void;
}) {
  const aria = { "aria-invalid": invalid || undefined, "aria-describedby": describedBy };
  const group = { id, "aria-labelledby": `${id}-label`, ...aria };

  switch (field.kind) {
    case "boolean":
      return (
        <div className="flex gap-1.5" role="group" {...group}>
          {[true, false].map((opt) => {
            const selected = value === opt;
            return (
              <button
                key={String(opt)}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange(selected && !field.required ? undefined : opt)}
                className={pillClass(selected)}
              >
                {String(opt)}
              </button>
            );
          })}
        </div>
      );

    case "single-enum": {
      const options = field.options ?? [];
      if (options.length > PILL_LIMIT) {
        return (
          <select
            id={id}
            {...aria}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            onBlur={onBlur}
            className={cn(
              "h-9 w-full cursor-pointer rounded-md border border-border bg-black/25 px-3 text-sm shadow-[inset_0_1px_4px_rgba(0,0,0,0.35)] outline-none",
              "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
              "aria-invalid:border-destructive",
            )}
          >
            <option value="">{field.required ? "Select an option" : "No selection"}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      }
      return (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" {...group}>
          {options.map((o) => {
            const selected = value === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={selected}
                title={o.label !== o.value ? o.value : undefined}
                onClick={() => onChange(selected && !field.required ? undefined : o.value)}
                className={pillClass(selected)}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }

    case "multi-enum": {
      const options = field.options ?? [];
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5" role="group" {...group}>
            {options.map((o) => {
              const on = selected.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  title={o.label !== o.value ? o.value : undefined}
                  onClick={() =>
                    onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])
                  }
                  className={cn(pillClass(on), "inline-flex items-center gap-1.5")}
                >
                  <span
                    className={cn(
                      "grid size-3.5 place-items-center rounded-sm border",
                      on ? "border-success/60 bg-success/20" : "border-border",
                    )}
                  >
                    {on && <Check className="size-2.5" />}
                  </span>
                  {o.label}
                </button>
              );
            })}
          </div>
          <p className="font-mono text-[11px] text-muted-foreground/70">
            {selected.length} of {options.length} selected
          </p>
        </div>
      );
    }

    case "number":
    case "integer":
      return (
        <Input
          id={id}
          type="number"
          inputMode={field.kind === "integer" ? "numeric" : "decimal"}
          step={field.kind === "integer" ? 1 : "any"}
          {...(field.minimum !== undefined ? { min: field.minimum } : {})}
          {...(field.maximum !== undefined ? { max: field.maximum } : {})}
          {...aria}
          className="w-full"
          value={typeof value === "string" ? value : ""}
          placeholder={field.kind === "integer" ? "0" : "0.0"}
          onChange={(e) => onChange(e.target.value, false)}
          onBlur={onBlur}
        />
      );

    case "string":
      return (
        <Input
          id={id}
          type={(field.format && STRING_INPUT[field.format]?.type) ?? "text"}
          {...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {})}
          {...aria}
          className="w-full"
          value={typeof value === "string" ? value : ""}
          placeholder={(field.format && STRING_INPUT[field.format]?.placeholder) ?? "value"}
          onChange={(e) => onChange(e.target.value, false)}
          onBlur={onBlur}
        />
      );
  }
}

function InspectJson({ params, preview }: { params: unknown; preview: unknown }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-md border border-border/60">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left font-mono text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        Inspect JSON
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/60 p-3">
          <CodeBlock language="application/json" caption="elicitation/create params">
            {JSON.stringify(params, null, 2)}
          </CodeBlock>
          <CodeBlock language="application/json" caption="Response preview">
            {JSON.stringify(preview, null, 2)}
          </CodeBlock>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* URL mode                                                            */
/* ------------------------------------------------------------------ */

export function UrlElicitationDetails({
  params,
  serverName,
}: {
  params: Pick<ElicitationUrlParams, "url" | "elicitationId">;
  serverName?: string;
}) {
  const check = React.useMemo(() => validateElicitationUrl(params.url), [params.url]);
  const [opened, setOpened] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const completed = useElicitationStore((s) =>
    params.elicitationId
      ? s.completions.some(
          (c) =>
            c.elicitationId === params.elicitationId &&
            (serverName === undefined || c.serverName === serverName),
        )
      : false,
  );

  const copy = () => {
    void navigator.clipboard?.writeText(params.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const open = () => {
    if (!check.valid) return;
    window.open(check.url.href, "_blank", "noopener,noreferrer");
    setOpened(true);
  };

  return (
    <div className="space-y-3">
      {check.valid ? (
        <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Opens</div>
          <div className="font-mono text-base font-semibold text-info" data-testid="elicitation-origin">
            {check.origin}
          </div>
        </div>
      ) : (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            This link is blocked. {check.reason}
          </span>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-md border border-border/60 bg-black/25">
        <code className="min-w-0 flex-1 select-all break-all px-3 py-2 font-mono text-xs text-foreground/90">
          {params.url}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy URL"
          className="m-1 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        >
          {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
          {copied ? "copied" : "copy"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!check.valid} onClick={open}>
          <ExternalLink className="size-3.5" />
          Open URL
        </Button>
        {opened && !completed && (
          <Badge variant="muted">opened, waiting for the server</Badge>
        )}
        {completed && (
          <Badge variant="success">
            <CheckCircle2 />
            Completed
          </Badge>
        )}
        {params.elicitationId && (
          <span className="ml-auto font-mono text-[11px] text-muted-foreground/70">
            id {params.elicitationId}
          </span>
        )}
      </div>
    </div>
  );
}
