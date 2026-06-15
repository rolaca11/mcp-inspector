/**
 * Assertion evaluation. An `expect` block maps result dot-paths to either a
 * literal (shorthand for `equals`) or a matcher object (`{contains: "x"}`).
 * `evaluateExpect` resolves each path against the (normalized) step result and
 * runs the matcher, producing one `AssertionResult` per matcher.
 */

import { getPath, interpolate, type Scope } from "./vars.js";

export interface AssertionResult {
  /** Result dot-path the assertion targeted (e.g. `content.0.text`, `isError`). */
  path: string;
  /** Matcher name (`equals`, `contains`, …). */
  matcher: string;
  ok: boolean;
  /** Human-readable failure description (empty when `ok`). */
  message: string;
  expected: unknown;
  actual: unknown;
}

const MATCHER_KEYS = [
  "equals",
  "contains",
  "matches",
  "exists",
  "type",
  "gt",
  "gte",
  "lt",
  "lte",
  "oneOf",
  "length",
] as const;
type MatcherKey = (typeof MATCHER_KEYS)[number];
const MATCHER_SET = new Set<string>(MATCHER_KEYS);

/**
 * A value is treated as a matcher object only when it is a plain object whose
 * keys are all known matcher names. Otherwise it's a literal (deep-`equals`).
 * To deep-equal an object that happens to use only matcher-named keys, wrap it:
 * `{equals: {...}}`.
 */
function isMatcherObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => MATCHER_SET.has(k));
}

export function evaluateExpect(
  result: unknown,
  expect: Record<string, unknown>,
  scope: Scope,
): AssertionResult[] {
  const out: AssertionResult[] = [];
  for (const [path, rawSpec] of Object.entries(expect)) {
    const actual = getPath(result, path);
    const spec = interpolate(rawSpec, scope);
    if (isMatcherObject(spec)) {
      for (const [mk, mv] of Object.entries(spec)) {
        out.push(runMatcher(path, mk as MatcherKey, mv, actual));
      }
    } else {
      out.push(runMatcher(path, "equals", spec, actual));
    }
  }
  return out;
}

function runMatcher(
  path: string,
  matcher: MatcherKey,
  expected: unknown,
  actual: unknown,
): AssertionResult {
  let ok = false;
  let message = "";

  switch (matcher) {
    case "equals":
      ok = deepEqual(actual, expected);
      if (!ok) message = `expected ${fmt(actual)} to equal ${fmt(expected)}`;
      break;
    case "contains":
      if (typeof actual === "string") ok = actual.includes(String(expected));
      else if (Array.isArray(actual)) ok = actual.some((x) => deepEqual(x, expected));
      if (!ok) message = `expected ${fmt(actual)} to contain ${fmt(expected)}`;
      break;
    case "matches": {
      let re: RegExp | null = null;
      try {
        re = new RegExp(String(expected));
      } catch (e) {
        return {
          path,
          matcher,
          ok: false,
          message: `invalid regex ${fmt(expected)}: ${(e as Error).message}`,
          expected,
          actual,
        };
      }
      ok = typeof actual === "string" && re.test(actual);
      if (!ok) message = `expected ${fmt(actual)} to match /${String(expected)}/`;
      break;
    }
    case "exists":
      ok = (actual !== undefined) === Boolean(expected);
      if (!ok)
        message = expected
          ? `expected ${path} to exist`
          : `expected ${path} to not exist (got ${fmt(actual)})`;
      break;
    case "type":
      ok = typeName(actual) === expected;
      if (!ok)
        message = `expected ${path} to be type ${fmt(expected)}, got ${typeName(actual)}`;
      break;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const e = Number(expected);
      ok = typeof actual === "number" && compareNum(matcher, actual, e);
      if (!ok)
        message = `expected ${fmt(actual)} ${OP_SYMBOL[matcher]} ${fmt(expected)}`;
      break;
    }
    case "oneOf":
      ok = Array.isArray(expected) && expected.some((x) => deepEqual(actual, x));
      if (!ok) message = `expected ${fmt(actual)} to be one of ${fmt(expected)}`;
      break;
    case "length": {
      const len = lengthOf(actual);
      ok = len === Number(expected);
      if (!ok)
        message = `expected ${path} to have length ${fmt(expected)}, got ${len ?? "n/a"}`;
      break;
    }
  }

  return { path, matcher, ok, message, expected, actual };
}

const OP_SYMBOL: Record<"gt" | "gte" | "lt" | "lte", string> = {
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};

function compareNum(op: "gt" | "gte" | "lt" | "lte", a: number, b: number): boolean {
  switch (op) {
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    case "lt":
      return a < b;
    case "lte":
      return a <= b;
  }
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function lengthOf(v: unknown): number | undefined {
  if (typeof v === "string" || Array.isArray(v)) return v.length;
  return undefined;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every((k) =>
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    );
  }
  return false;
}

/** Compact, length-capped rendering of a value for failure messages. */
function fmt(v: unknown): string {
  let s: string;
  try {
    s = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v) ?? String(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) s = String(v);
  return s.length > 120 ? s.slice(0, 117) + "..." : s;
}
