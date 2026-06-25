/**
 * Custom vitest matchers for MCP results. Each accepts either a result returned
 * by `wrap()` or a raw SDK result (duck-typed via `.raw`), normalizes it through
 * the shared helpers, and renders an MCP-aware failure message. The numeric /
 * range / one-of assertions of the old YAML runner are intentionally dropped —
 * reach through a typed accessor into plain vitest instead, e.g.
 * `expect(res.json<{ n: number }>().n).toBeGreaterThan(3)`.
 *
 * `installMcpMatchers()` registers them with `expect.extend`; it is idempotent
 * and is what the `@rolaca11/mcp-inspector-vitest/setup` entry calls. The
 * matching TypeScript augmentation of `"vitest"` lives in `index.ts`.
 */

import { expect, type MatcherResult, type MatcherState } from "vitest";

import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import { coerceIsError, joinText, listNames } from "./normalize.js";

/** Fields `toMatchResource` can assert on a `readResource` result. */
export interface ResourceExpectation {
  uri?: string;
  mimeType?: string;
  text?: string | RegExp;
}

/** The matcher surface; `index.ts` mixes this into vitest's `Matchers`. */
export interface McpMatchers<R = unknown> {
  /** Tool result whose `isError` is false. */
  toBeOk(): R;
  /** Tool result whose `isError` is true; optionally its text contains/matches. */
  toBeMcpError(expected?: string | RegExp): R;
  /** Joined result text contains the substring or matches the RegExp. */
  toHaveText(expected: string | RegExp): R;
  /** At least one content block has the given discriminated type. */
  toHaveContentType(type: ContentBlock["type"]): R;
  /** `structuredContent` deep-equals `expected` (asymmetric-matcher aware). */
  toHaveStructured(expected: unknown): R;
  /** A list result's names include every given name. */
  toListName(...names: string[]): R;
  /** A `readResource` result matches the given uri / mimeType / text fields. */
  toMatchResource(expected: ResourceExpectation): R;
}

/** A uniform read over either a wrapped result or a raw SDK result. */
interface View {
  raw: unknown;
  isError: boolean;
  text: string;
  content: unknown[];
  contents: unknown[];
  structuredContent: unknown;
  names: string[];
}

function view(received: unknown): View {
  const wrapper =
    received !== null && typeof received === "object"
      ? (received as Record<string, unknown>)
      : {};
  const raw = "raw" in wrapper ? wrapper.raw : received;
  const r =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};
  return {
    raw,
    isError: coerceIsError(raw),
    text: joinText(raw),
    content: Array.isArray(r.content) ? r.content : [],
    contents: Array.isArray(r.contents) ? r.contents : [],
    structuredContent: r.structuredContent,
    names: listNames(raw),
  };
}

function textMatches(text: string, expected: string | RegExp): boolean {
  return typeof expected === "string" ? text.includes(expected) : expected.test(text);
}

function showText(text: string): string {
  return text === "" ? "(no text content)" : text;
}

function blockType(block: unknown): unknown {
  return block !== null && typeof block === "object"
    ? (block as { type?: unknown }).type
    : undefined;
}

const matchers = {
  toBeOk(this: MatcherState, received: unknown): MatcherResult {
    const v = view(received);
    return {
      pass: !v.isError,
      message: () =>
        `expected MCP tool result ${this.isNot ? "not " : ""}to be ok (isError=false)\n` +
        `  isError: ${this.utils.printReceived(v.isError)}\n` +
        `  text: ${this.utils.printReceived(showText(v.text))}`,
    };
  },

  toBeMcpError(
    this: MatcherState,
    received: unknown,
    expected?: string | RegExp,
  ): MatcherResult {
    const v = view(received);
    const textOk = expected === undefined || textMatches(v.text, expected);
    return {
      pass: v.isError && textOk,
      message: () => {
        if (!v.isError) {
          return (
            `expected MCP tool result ${this.isNot ? "not " : ""}to be an error (isError=true)\n` +
            `  isError: ${this.utils.printReceived(false)}\n` +
            `  text: ${this.utils.printReceived(showText(v.text))}`
          );
        }
        return (
          `expected error text ${this.isNot ? "not " : ""}to ` +
          `${typeof expected === "string" ? "contain" : "match"} ${this.utils.printExpected(expected)}\n` +
          `  text: ${this.utils.printReceived(showText(v.text))}`
        );
      },
    };
  },

  toHaveText(
    this: MatcherState,
    received: unknown,
    expected: string | RegExp,
  ): MatcherResult {
    const v = view(received);
    return {
      pass: textMatches(v.text, expected),
      message: () =>
        `expected result text ${this.isNot ? "not " : ""}to ` +
        `${typeof expected === "string" ? "contain" : "match"} ${this.utils.printExpected(expected)}\n` +
        `  text: ${this.utils.printReceived(showText(v.text))}`,
    };
  },

  toHaveContentType(
    this: MatcherState,
    received: unknown,
    type: ContentBlock["type"],
  ): MatcherResult {
    const v = view(received);
    const types = v.content.map(blockType);
    return {
      pass: types.includes(type),
      message: () =>
        `expected content ${this.isNot ? "not " : ""}to include a block of type ${this.utils.printExpected(type)}\n` +
        `  block types: ${this.utils.printReceived(types)}`,
    };
  },

  toHaveStructured(
    this: MatcherState,
    received: unknown,
    expected: unknown,
  ): MatcherResult {
    const v = view(received);
    return {
      pass: this.equals(v.structuredContent, expected, this.customTesters),
      actual: v.structuredContent,
      expected,
      message: () =>
        `expected structuredContent ${this.isNot ? "not " : ""}to match\n` +
        (this.utils.diff(expected, v.structuredContent) ?? ""),
    };
  },

  toListName(
    this: MatcherState,
    received: unknown,
    ...names: string[]
  ): MatcherResult {
    const v = view(received);
    const missing = names.filter((n) => !v.names.includes(n));
    return {
      pass: names.length > 0 && missing.length === 0,
      message: () =>
        `expected list ${this.isNot ? "not " : ""}to include name(s) ${this.utils.printExpected(names)}\n` +
        (missing.length ? `  missing: ${this.utils.printReceived(missing)}\n` : "") +
        `  names: ${this.utils.printReceived(v.names)}`,
    };
  },

  toMatchResource(
    this: MatcherState,
    received: unknown,
    expected: ResourceExpectation,
  ): MatcherResult {
    const v = view(received);
    const entries = v.contents.map((c) =>
      c !== null && typeof c === "object" ? (c as Record<string, unknown>) : {},
    );
    const unmatched: string[] = [];
    if (expected.uri !== undefined && !entries.some((c) => c.uri === expected.uri)) {
      unmatched.push(`uri ${this.utils.printExpected(expected.uri)}`);
    }
    if (
      expected.mimeType !== undefined &&
      !entries.some((c) => c.mimeType === expected.mimeType)
    ) {
      unmatched.push(`mimeType ${this.utils.printExpected(expected.mimeType)}`);
    }
    if (expected.text !== undefined && !textMatches(v.text, expected.text)) {
      unmatched.push(`text ${this.utils.printExpected(expected.text)}`);
    }
    return {
      pass: unmatched.length === 0,
      message: () =>
        `expected resource ${this.isNot ? "not " : ""}to match the given fields\n` +
        (unmatched.length ? `  unmatched: ${unmatched.join(", ")}\n` : "") +
        `  contents: ${this.utils.printReceived(v.contents)}`,
    };
  },
};

let installed = false;

/** Register the MCP matchers with vitest's `expect`. Idempotent. */
export function installMcpMatchers(): void {
  if (installed) return;
  installed = true;
  expect.extend(matchers);
}
