/**
 * Token counting via tiktoken. Counts how many Claude tokens an MCP
 * server response would consume — useful for estimating how much of a
 * context window a response occupies.
 *
 * Runs entirely locally (no network calls, no API key required).
 */

import {encoding_for_model, type Tiktoken} from "tiktoken";

let _enc: Tiktoken | undefined;

function getEncoder(): Tiktoken {
  _enc ??= encoding_for_model("gpt-5-chat-latest");
  return _enc;
}

export type TokenCountResult =
  | { ok: true; tokens: number }
  | { ok: false; reason: "error"; error: string };

/**
 * Count the number of tokens a value would occupy. Accepts an
 * arbitrary value (JSON-serialized) or a plain string.
 */
export function countResponseTokens(value: unknown): TokenCountResult {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    const tokens = getEncoder().encode(text);
    return { ok: true, tokens: tokens.length };
  } catch (e) {
    return { ok: false, reason: "error", error: (e as Error).message };
  }
}
