export type ElicitationAction = "accept" | "decline" | "cancel";

export type ElicitationContentValue = string | number | boolean | string[];

export type ElicitationContent = Record<string, ElicitationContentValue>;

export interface ElicitationResult {
  action: ElicitationAction;
  content?: ElicitationContent;
}

type ElicitationStringFormat = "email" | "uri" | "date" | "date-time";

interface ElicitationPrimitiveSchema {
  type: "boolean" | "string" | "number" | "integer" | "array";
  [k: string]: unknown;
}

export interface ElicitationRequestedSchema {
  type: "object";
  properties: Record<string, ElicitationPrimitiveSchema>;
  required?: string[];
  [k: string]: unknown;
}

export interface ElicitationFormParams {
  mode: "form";
  message: string;
  requestedSchema: ElicitationRequestedSchema;
  _meta?: Record<string, unknown>;
}

export interface ElicitationUrlParams {
  mode: "url";
  message: string;
  url: string;
  elicitationId?: string;
  _meta?: Record<string, unknown>;
}

export type ElicitationRequestParams = ElicitationFormParams | ElicitationUrlParams;

export interface PendingElicitation {
  id: string;
  serverName: string;
  createdAt: string;
  params: ElicitationRequestParams;
}

export interface ElicitationCompletionEvent {
  serverName: string;
  elicitationId: string;
  completedAt: string;
}

export interface ElicitationHandlerContext {
  signal?: AbortSignal;
}

export type ElicitationHandler = (
  params: ElicitationRequestParams,
  ctx: ElicitationHandlerContext,
) => Promise<ElicitationResult>;

interface ElicitationFieldOption {
  value: string;
  label: string;
}

export interface NormalizedElicitationField {
  name: string;
  kind: "boolean" | "string" | "number" | "integer" | "single-enum" | "multi-enum";
  label: string;
  description?: string;
  required: boolean;
  options?: ElicitationFieldOption[];
  minLength?: number;
  maxLength?: number;
  format?: ElicitationStringFormat;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  default?: ElicitationContentValue;
}

const URL_ELICITATION_REQUIRED_CODE = -32042;
export const LONG_REQUEST_OPTIONS = { timeout: 600_000, resetTimeoutOnProgress: true } as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function normalizeElicitationParams(params: {
  mode?: "form" | "url";
  message: string;
  [k: string]: unknown;
}): ElicitationRequestParams {
  return { ...params, mode: params.mode ?? "form" } as ElicitationRequestParams;
}

export function normalizeElicitationResult(
  params: Pick<ElicitationRequestParams, "mode">,
  result: ElicitationResult,
): ElicitationResult {
  if (result.action === "accept" && params.mode === "form" && result.content !== undefined) {
    return { action: "accept", content: result.content };
  }
  return { action: result.action };
}

export function validateElicitationUrl(
  rawUrl: string,
): { valid: true; url: URL; origin: string; host: string } | { valid: false; reason: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { valid: false, reason: "The server sent a URL that cannot be parsed." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      valid: false,
      reason: `Only http: and https: URLs can be opened, not ${url.protocol}`,
    };
  }
  return { valid: true, url, origin: url.origin, host: url.host };
}

export function extractUrlElicitationError(
  error: unknown,
): { message: string; elicitations: ElicitationUrlParams[] } | null {
  const seen = new Set<unknown>();
  let cur: unknown = error;
  while (isRecord(cur) || cur instanceof Error) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const candidate = cur as { code?: unknown; data?: unknown; message?: unknown; cause?: unknown };
    const data = candidate.data;
    if (
      candidate.code === URL_ELICITATION_REQUIRED_CODE &&
      isRecord(data) &&
      Array.isArray(data.elicitations)
    ) {
      const elicitations: ElicitationUrlParams[] = [];
      for (const entry of data.elicitations) {
        if (!isRecord(entry) || typeof entry.url !== "string") continue;
        elicitations.push({
          mode: "url",
          message: typeof entry.message === "string" ? entry.message : "",
          url: entry.url,
          ...(typeof entry.elicitationId === "string" ? { elicitationId: entry.elicitationId } : {}),
        });
      }
      const message =
        typeof candidate.message === "string" && candidate.message
          ? candidate.message
          : "URL elicitation required";
      return { message, elicitations };
    }
    cur = candidate.cause;
  }
  return null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function constOptions(entries: unknown): ElicitationFieldOption[] | undefined {
  if (!Array.isArray(entries)) return undefined;
  const options: ElicitationFieldOption[] = [];
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.const !== "string") continue;
    options.push({
      value: entry.const,
      label: typeof entry.title === "string" && entry.title ? entry.title : entry.const,
    });
  }
  return options;
}

function enumOptions(values: unknown, names?: unknown): ElicitationFieldOption[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const labels = Array.isArray(names) ? names : [];
  return values
    .filter((v): v is string => typeof v === "string")
    .map((value, i) => {
      const label = labels[i];
      return { value, label: typeof label === "string" && label ? label : value };
    });
}

const STRING_FORMATS = new Set<unknown>(["email", "uri", "date", "date-time"]);

function copyNumbers(
  field: NormalizedElicitationField,
  raw: Record<string, unknown>,
  keys: Array<"minimum" | "maximum" | "minLength" | "maxLength" | "minItems" | "maxItems">,
): void {
  for (const key of keys) {
    const value = finiteNumber(raw[key]);
    if (value !== undefined) field[key] = value;
  }
}

function describePrimitiveField(
  name: string,
  raw: ElicitationPrimitiveSchema,
  required: boolean,
): NormalizedElicitationField {
  const field: NormalizedElicitationField = {
    name,
    kind: "string",
    label: typeof raw.title === "string" && raw.title ? raw.title : name,
    required,
  };
  if (typeof raw.description === "string" && raw.description) {
    field.description = raw.description;
  }

  if (raw.type === "boolean") {
    field.kind = "boolean";
    if (typeof raw.default === "boolean") field.default = raw.default;
    return field;
  }

  if (raw.type === "number" || raw.type === "integer") {
    field.kind = raw.type;
    copyNumbers(field, raw, ["minimum", "maximum"]);
    const def = finiteNumber(raw.default);
    if (def !== undefined) field.default = def;
    return field;
  }

  if (raw.type === "array") {
    field.kind = "multi-enum";
    const items = isRecord(raw.items) ? raw.items : {};
    field.options = constOptions(items.anyOf) ?? constOptions(items.oneOf) ?? enumOptions(items.enum) ?? [];
    copyNumbers(field, raw, ["minItems", "maxItems"]);
    if (Array.isArray(raw.default) && raw.default.every((v) => typeof v === "string")) {
      field.default = [...raw.default];
    }
    return field;
  }

  const options = constOptions(raw.oneOf) ?? enumOptions(raw.enum, raw.enumNames);
  if (options) {
    field.kind = "single-enum";
    field.options = options;
  } else {
    copyNumbers(field, raw, ["minLength", "maxLength"]);
    if (STRING_FORMATS.has(raw.format)) field.format = raw.format as ElicitationStringFormat;
  }
  if (typeof raw.default === "string") field.default = raw.default;
  return field;
}

export function describeElicitationForm(
  requestedSchema: ElicitationRequestedSchema,
): NormalizedElicitationField[] {
  const required = new Set(requestedSchema.required ?? []);
  return Object.entries(requestedSchema.properties ?? {}).map(([name, schema]) =>
    describePrimitiveField(name, schema, required.has(name)),
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|([+-])(\d{2}):(\d{2}))$/;

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day <= days;
}

function checkFormat(value: string, format: ElicitationStringFormat): string | null {
  switch (format) {
    case "email":
      return EMAIL_RE.test(value) ? null : "Enter a valid email address";
    case "uri": {
      if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) return "Enter a valid URI";
      try {
        new URL(value);
        return null;
      } catch {
        return "Enter a valid URI";
      }
    }
    case "date": {
      const m = DATE_RE.exec(value);
      return m && isCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]))
        ? null
        : "Enter a valid date (YYYY-MM-DD)";
    }
    case "date-time": {
      const m = DATE_TIME_RE.exec(value);
      const invalid = "Enter a valid date-time with a timezone (e.g. 2026-01-31T09:30:00Z)";
      if (!m) return invalid;
      if (!isCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]))) return invalid;
      if (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 60) return invalid;
      if (m[9] && (Number(m[10]) > 23 || Number(m[11]) > 59)) return invalid;
      return null;
    }
  }
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function validateElicitationField(
  field: NormalizedElicitationField,
  value: unknown,
): { ok: true; value: ElicitationContentValue | undefined } | { ok: false; error: string } {
  const effective = isEmpty(value) ? field.default : value;
  if (isEmpty(effective)) {
    if (field.required) return { ok: false, error: "This field is required" };
    return { ok: true, value: undefined };
  }

  switch (field.kind) {
    case "boolean":
      if (typeof effective !== "boolean") return { ok: false, error: "Expected true or false" };
      return { ok: true, value: effective };

    case "number":
    case "integer": {
      if (typeof effective !== "number" || !Number.isFinite(effective)) {
        return { ok: false, error: "Expected a number" };
      }
      if (field.kind === "integer" && !Number.isInteger(effective)) {
        return { ok: false, error: "Expected a whole number" };
      }
      if (field.minimum !== undefined && effective < field.minimum) {
        return { ok: false, error: `Must be at least ${field.minimum}` };
      }
      if (field.maximum !== undefined && effective > field.maximum) {
        return { ok: false, error: `Must be at most ${field.maximum}` };
      }
      return { ok: true, value: effective };
    }

    case "single-enum": {
      if (typeof effective !== "string") return { ok: false, error: "Expected one of the listed options" };
      if (!field.options?.some((o) => o.value === effective)) {
        return { ok: false, error: `"${effective}" is not one of the allowed options` };
      }
      return { ok: true, value: effective };
    }

    case "multi-enum": {
      if (!Array.isArray(effective) || !effective.every((v) => typeof v === "string")) {
        return { ok: false, error: "Expected a list of options" };
      }
      const allowed = new Set(field.options?.map((o) => o.value));
      const unknown = effective.find((v) => !allowed.has(v));
      if (unknown !== undefined) {
        return { ok: false, error: `"${unknown}" is not one of the allowed options` };
      }
      if (new Set(effective).size !== effective.length) {
        return { ok: false, error: "Each option can only be selected once" };
      }
      if (field.minItems !== undefined && effective.length < field.minItems) {
        return { ok: false, error: `Select at least ${plural(field.minItems, "option")}` };
      }
      if (field.maxItems !== undefined && effective.length > field.maxItems) {
        return { ok: false, error: `Select at most ${plural(field.maxItems, "option")}` };
      }
      return { ok: true, value: [...effective] };
    }

    case "string": {
      if (typeof effective !== "string") return { ok: false, error: "Expected text" };
      const length = Array.from(effective).length;
      if (field.minLength !== undefined && length < field.minLength) {
        return { ok: false, error: `Must be at least ${plural(field.minLength, "character")}` };
      }
      if (field.maxLength !== undefined && length > field.maxLength) {
        return { ok: false, error: `Must be at most ${plural(field.maxLength, "character")}` };
      }
      if (field.format) {
        const error = checkFormat(effective, field.format);
        if (error) return { ok: false, error };
      }
      return { ok: true, value: effective };
    }
  }
}

export function validateElicitationFormContent(
  requestedSchema: ElicitationRequestedSchema,
  content: Record<string, unknown> | undefined,
): { ok: true; content: ElicitationContent } | { ok: false; errors: Record<string, string> } {
  const values = content ?? {};
  const errors: Record<string, string> = {};
  const result: ElicitationContent = {};
  for (const field of describeElicitationForm(requestedSchema)) {
    const outcome = validateElicitationField(field, values[field.name]);
    if (!outcome.ok) errors[field.name] = outcome.error;
    else if (outcome.value !== undefined) result[field.name] = outcome.value;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, content: result };
}
