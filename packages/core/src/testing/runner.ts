/**
 * Executes loaded suites against MCP servers. Connects once per unique target
 * (reusing the session across cases), runs each case's steps in order, applies
 * captures, and evaluates expectations — collecting a structured `RunReport`
 * that the reporters render. Nothing here prints; the CLI owns output.
 */

import { connect, type ConnectOptions, type Session } from "../client.js";
import { errorMessage } from "../format.js";
import { parseTarget, targetId } from "../target.js";
import { evaluateExpect, type AssertionResult } from "./matchers.js";
import { getPath, interpolate, type Scope } from "./vars.js";
import type { Case, CompleteArgs, ListKind, LoadedSuite, Step, Suite } from "./schema.js";

type McpClient = Session["client"];

export interface StepReport {
  index: number;
  /** Human label, e.g. `call echo`, `read file://x`. */
  action: string;
  assertions: AssertionResult[];
  /** Set when the MCP call itself threw (protocol error, unknown tool, …). */
  error?: string;
  durationMs: number;
  ok: boolean;
}

export interface CaseReport {
  name: string;
  source: string;
  target: string;
  steps: StepReport[];
  ok: boolean;
  durationMs: number;
  /** Set when the case couldn't run at all (no target, connect failed). */
  error?: string;
}

export interface RunReport {
  cases: CaseReport[];
  passed: number;
  failed: number;
  durationMs: number;
  ok: boolean;
}

/** Identifies a case as it begins, for live/streaming reporters. */
export interface CaseStartInfo {
  name: string;
  source: string;
}

export interface RunOptions {
  /** Fallback target for suites/cases that don't declare one (CLI `--target`). */
  defaultTarget?: string;
  /** Seed variables (CLI `--var k=v`), lowest precedence. */
  vars?: Record<string, unknown>;
  /** Stop after the first failing case. */
  bail?: boolean;
  /** Only run cases whose name includes this substring. */
  filter?: string;
  /** Forwarded to `connect()` (scope, clientName, quiet). */
  connectOptions?: ConnectOptions;
  /** Injectable connect for tests; defaults to the real `connect`. */
  connectFn?: typeof connect;
  /** Fired before each case runs — for live/streaming reporters. */
  onCaseStart?: (info: CaseStartInfo) => void;
  /** Fired after each case completes — for live/streaming reporters. */
  onCaseComplete?: (report: CaseReport) => void;
}

export async function runSuites(
  suites: LoadedSuite[],
  opts: RunOptions = {},
): Promise<RunReport> {
  const connectFn = opts.connectFn ?? connect;
  const sessions = new Map<string, Session>();
  const cases: CaseReport[] = [];
  const runStart = performance.now();

  const planned = suites.flatMap(({ source, suite }) =>
    suite.cases
      .filter((tc) => !opts.filter || tc.name.includes(opts.filter))
      .map((tc) => ({ tc, suite, source })),
  );

  try {
    for (const { tc, suite, source } of planned) {
      opts.onCaseStart?.({ name: tc.name, source });
      const report = await runCase(tc, suite, source, sessions, connectFn, opts);
      cases.push(report);
      opts.onCaseComplete?.(report);
      if (!report.ok && opts.bail) break;
    }
  } finally {
    for (const s of sessions.values()) await s.close().catch(() => {});
  }

  const passed = cases.filter((c) => c.ok).length;
  const failed = cases.length - passed;
  return {
    cases,
    passed,
    failed,
    durationMs: elapsed(runStart),
    ok: failed === 0,
  };
}

async function runCase(
  tc: Case,
  suite: Suite,
  source: string,
  sessions: Map<string, Session>,
  connectFn: typeof connect,
  opts: RunOptions,
): Promise<CaseReport> {
  const caseStart = performance.now();
  const targetStr = tc.target ?? suite.target ?? opts.defaultTarget;

  if (!targetStr) {
    return {
      name: tc.name,
      source,
      target: "(none)",
      steps: [],
      ok: false,
      durationMs: elapsed(caseStart),
      error:
        "no target specified — set `target:` in the suite or case, or pass --target",
    };
  }

  // Vars precedence (low -> high): CLI seeds, suite vars, case vars.
  const scope: Scope = {
    ...(opts.vars ?? {}),
    ...(suite.vars ?? {}),
    ...(tc.vars ?? {}),
  };

  let session: Session;
  try {
    session = await getSession(targetStr, sessions, connectFn, opts);
  } catch (e) {
    return {
      name: tc.name,
      source,
      target: targetStr,
      steps: [],
      ok: false,
      durationMs: elapsed(caseStart),
      error: `connection failed: ${errorMessage(e)}`,
    };
  }

  const steps: StepReport[] = [];
  let ok = true;
  for (let i = 0; i < tc.steps.length; i++) {
    const sr = await runStep(tc.steps[i] as Step, i, session, scope);
    steps.push(sr);
    // A failed step often leaves later steps without captured vars, so stop.
    if (!sr.ok) {
      ok = false;
      break;
    }
  }

  return { name: tc.name, source, target: targetStr, steps, ok, durationMs: elapsed(caseStart) };
}

async function runStep(
  step: Step,
  index: number,
  session: Session,
  scope: Scope,
): Promise<StepReport> {
  const stepStart = performance.now();
  try {
    const { action, raw } = await executeStep(step, session.client, scope);
    const result = normalize(raw);

    if (step.capture) {
      for (const [name, path] of Object.entries(step.capture)) {
        scope[name] = getPath(result, path);
      }
    }

    const assertions = step.expect ? evaluateExpect(result, step.expect, scope) : [];
    return {
      index,
      action,
      assertions,
      ok: assertions.every((a) => a.ok),
      durationMs: elapsed(stepStart),
    };
  } catch (e) {
    return {
      index,
      action: actionLabel(step),
      assertions: [],
      ok: false,
      error: errorMessage(e),
      durationMs: elapsed(stepStart),
    };
  }
}

async function executeStep(
  step: Step,
  client: McpClient,
  scope: Scope,
): Promise<{ action: string; raw: unknown }> {
  if (step.call !== undefined) {
    const args = interpolate(step.with ?? {}, scope) as Record<string, unknown>;
    const raw = await client.callTool({ name: step.call, arguments: args });
    return { action: `call ${step.call}`, raw };
  }
  if (step.read !== undefined) {
    const uri = String(interpolate(step.read, scope));
    const raw = await client.readResource({ uri });
    return { action: `read ${uri}`, raw };
  }
  if (step.get !== undefined) {
    const args = interpolate(step.with ?? {}, scope) as Record<string, unknown>;
    const stringArgs: Record<string, string> = {};
    for (const [k, v] of Object.entries(args)) {
      stringArgs[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    const raw = await client.getPrompt({ name: step.get, arguments: stringArgs });
    return { action: `get ${step.get}`, raw };
  }
  if (step.list !== undefined) {
    return { action: `list ${step.list}`, raw: await listByKind(client, step.list) };
  }
  if (step.complete !== undefined) {
    return {
      action: `complete ${step.complete.ref}`,
      raw: await runComplete(client, step.complete, scope),
    };
  }
  throw new Error("step has no action");
}

function actionLabel(step: Step): string {
  if (step.call !== undefined) return `call ${step.call}`;
  if (step.read !== undefined) return `read ${step.read}`;
  if (step.get !== undefined) return `get ${step.get}`;
  if (step.list !== undefined) return `list ${step.list}`;
  if (step.complete !== undefined) return `complete ${step.complete.ref}`;
  return "(unknown)";
}

function listByKind(client: McpClient, kind: ListKind) {
  switch (kind) {
    case "tools":
      return client.listTools();
    case "resources":
      return client.listResources();
    case "templates":
      return client.listResourceTemplates();
    case "prompts":
      return client.listPrompts();
  }
}

function runComplete(client: McpClient, c: CompleteArgs, scope: Scope) {
  const ref =
    c.refType === "prompt"
      ? { type: "ref/prompt" as const, name: c.ref }
      : { type: "ref/resource" as const, uri: c.ref };
  const params: {
    ref: typeof ref;
    argument: { name: string; value: string };
    context?: { arguments: Record<string, string> };
  } = {
    ref,
    argument: { name: c.argument, value: String(interpolate(c.value ?? "", scope)) },
  };
  if (c.context && Object.keys(c.context).length > 0) {
    params.context = { arguments: interpolate(c.context, scope) as Record<string, string> };
  }
  return client.complete(params);
}

async function getSession(
  targetStr: string,
  sessions: Map<string, Session>,
  connectFn: typeof connect,
  opts: RunOptions,
): Promise<Session> {
  const spec = parseTarget(targetStr);
  const key = targetId(spec);
  const existing = sessions.get(key);
  if (existing) return existing;
  const session = await connectFn(spec, opts.connectOptions ?? {});
  sessions.set(key, session);
  return session;
}

/* ------------------------------------------------------------------ */
/* Result normalization                                                */
/* ------------------------------------------------------------------ */

/**
 * Flattens a raw MCP result into a plain object assertions can address by path,
 * adding two virtual fields: `isError` (always a boolean) and `text` (all text
 * blocks joined). For list results, adds `names`.
 */
function normalize(raw: unknown): Record<string, unknown> {
  const base: Record<string, unknown> =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : { value: raw };
  base.isError = base.isError === true;
  base.text = collectText(base);
  const names = collectNames(base);
  if (names) base.names = names;
  return base;
}

function collectText(result: Record<string, unknown>): string {
  const parts: string[] = [];
  const content = result.content;
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b && typeof b === "object" && (b as { type?: string }).type === "text") {
        const t = (b as { text?: unknown }).text;
        if (typeof t === "string") parts.push(t);
      }
    }
  }
  const contents = result.contents;
  if (Array.isArray(contents)) {
    for (const c of contents) {
      const t = c && typeof c === "object" ? (c as { text?: unknown }).text : undefined;
      if (typeof t === "string") parts.push(t);
    }
  }
  const messages = result.messages;
  if (Array.isArray(messages)) {
    for (const m of messages) {
      const c = m && typeof m === "object" ? (m as { content?: unknown }).content : undefined;
      if (c && typeof c === "object" && (c as { type?: string }).type === "text") {
        const t = (c as { text?: unknown }).text;
        if (typeof t === "string") parts.push(t);
      }
    }
  }
  return parts.join("\n");
}

function collectNames(result: Record<string, unknown>): string[] | undefined {
  for (const key of ["tools", "resources", "resourceTemplates", "prompts"]) {
    const arr = result[key];
    if (Array.isArray(arr)) {
      return arr
        .map((x) => {
          if (!x || typeof x !== "object") return undefined;
          const o = x as { name?: unknown; uri?: unknown; uriTemplate?: unknown };
          const v = o.name ?? o.uri ?? o.uriTemplate;
          return typeof v === "string" ? v : undefined;
        })
        .filter((v): v is string => v !== undefined);
    }
  }
  return undefined;
}

function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}
