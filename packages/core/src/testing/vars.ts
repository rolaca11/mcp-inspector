/**
 * Variable interpolation (`${name}`, `${env.VAR}`) and dot-path resolution
 * (`content.0.text`) shared by the runner (substituting step arguments) and the
 * matchers (reading values out of a result and resolving expected values).
 */

/** Mutable bag of variables; the runner seeds it and `capture` adds to it. */
export type Scope = Record<string, unknown>;

const TOKEN = /\$\{([^}]+)\}/g;
const WHOLE = /^\$\{([^}]+)\}$/;

/**
 * Resolve a single `${...}` reference. `env.X` reads `process.env.X`; anything
 * else is a dot-path into the scope. Returns `undefined` when unresolved.
 */
export function resolveRef(ref: string, scope: Scope): unknown {
  const trimmed = ref.trim();
  if (trimmed.startsWith("env.")) return process.env[trimmed.slice(4)];
  return getPath(scope, trimmed);
}

/**
 * Recursively interpolate `${...}` tokens in any JSON-ish value. A string that
 * is exactly one token (`"${count}"`) yields the referenced value with its
 * original type (number, object, …); a string with surrounding text yields a
 * string with each token stringified in place.
 */
export function interpolate(value: unknown, scope: Scope): unknown {
  if (typeof value === "string") return interpolateString(value, scope);
  if (Array.isArray(value)) return value.map((v) => interpolate(v, scope));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolate(v, scope);
    }
    return out;
  }
  return value;
}

function interpolateString(s: string, scope: Scope): unknown {
  const whole = WHOLE.exec(s);
  if (whole) return resolveRef(whole[1] ?? "", scope);
  return s.replace(TOKEN, (_match, ref: string) => {
    const v = resolveRef(ref, scope);
    if (v === undefined || v === null) return "";
    return typeof v === "string" ? v : JSON.stringify(v);
  });
}

/**
 * Read a value out of `obj` by a dot-path. Numeric segments index into arrays
 * (or numeric object keys). Returns `undefined` when any segment is missing.
 * Keys containing literal dots are not addressable (documented limitation).
 */
export function getPath(obj: unknown, path: string): unknown {
  if (path === "") return obj;
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0) return undefined;
      cur = cur[idx];
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}
