/**
 * Token counting via @programsmagic/toon-tokenizer. Counts how many
 * Claude tokens an MCP server response would consume — useful for
 * estimating how much of a context window a response occupies.
 *
 * Runs entirely locally (no network calls, no API key required).
 */

// Import directly from the counter subpath to avoid the barrel index,
// which re-exports audit.js — that file has a broken dependency on the
// non-existent "@toon/converter" package. A pnpm patch adds the
// "./dist/*" export so this resolves correctly.
import { countTokensInData, countTokensInText } from "@programsmagic/toon-tokenizer/dist/counter.js";

const MODEL = "claude-3-sonnet" as const;

export type TokenCountResult =
  | { ok: true; tokens: number }
  | { ok: false; reason: "error"; error: string };

/**
 * Count the number of tokens a value would occupy. Accepts an
 * arbitrary value (serialized via the library's JSON-aware counter)
 * or a plain string.
 */
export function countResponseTokens(value: unknown): TokenCountResult {
  try {
    const result =
      typeof value === "string"
        ? countTokensInText(value, MODEL)
        : countTokensInData(value, MODEL);
    return { ok: true, tokens: result.tokens };
  } catch (e) {
    return { ok: false, reason: "error", error: (e as Error).message };
  }
}
