import { extractUrlElicitationError, type ElicitationUrlParams } from "../elicitation.js";
import { errorMessage } from "../format.js";
import { countResponseTokens } from "../tokens.js";

export interface ActivityEntry {
  kind: string;
  target: string;
  outcome: "ok" | "error";
  durationMs: number;
  tokenCount: number | null;
  result?: unknown;
  error?: string;
  warnings?: string[];
  urlElicitations?: ElicitationUrlParams[];
}

function errorEntry(kind: string, target: string, start: number, e: unknown): ActivityEntry {
  const urlElicitation = extractUrlElicitationError(e);
  return {
    kind,
    target,
    outcome: "error",
    durationMs: Math.round(performance.now() - start),
    tokenCount: null,
    error: urlElicitation ? urlElicitation.message : errorMessage(e),
    ...(urlElicitation ? { urlElicitations: urlElicitation.elicitations } : {}),
  };
}

export async function runActivity(
  kind: string,
  target: string,
  fn: () => Promise<unknown>,
): Promise<ActivityEntry> {
  const start = performance.now();
  try {
    const result = await fn();
    const counted = countResponseTokens(result);
    return {
      kind,
      target,
      outcome: "ok",
      durationMs: Math.round(performance.now() - start),
      tokenCount: counted.ok ? counted.tokens : null,
      result,
    };
  } catch (e) {
    return errorEntry(kind, target, start, e);
  }
}

export async function runActivityWithWarnings(
  kind: string,
  target: string,
  fn: () => Promise<{ result: unknown; warnings?: string[] }>,
): Promise<ActivityEntry> {
  const start = performance.now();
  try {
    const { result, warnings } = await fn();
    const counted = countResponseTokens(result);
    return {
      kind,
      target,
      outcome: "ok",
      durationMs: Math.round(performance.now() - start),
      tokenCount: counted.ok ? counted.tokens : null,
      result,
      warnings,
    };
  } catch (e) {
    return errorEntry(kind, target, start, e);
  }
}

export function errorActivity(
  kind: string,
  target: string,
  error: string,
): ActivityEntry {
  return { kind, target, outcome: "error", durationMs: 0, tokenCount: null, error };
}
