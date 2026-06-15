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
    return {
      kind,
      target,
      outcome: "error",
      durationMs: Math.round(performance.now() - start),
      tokenCount: null,
      error: errorMessage(e),
    };
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
    return {
      kind,
      target,
      outcome: "error",
      durationMs: Math.round(performance.now() - start),
      tokenCount: null,
      error: errorMessage(e),
    };
  }
}

export function errorActivity(
  kind: string,
  target: string,
  error: string,
): ActivityEntry {
  return { kind, target, outcome: "error", durationMs: 0, tokenCount: null, error };
}
