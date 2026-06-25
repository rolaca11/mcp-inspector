/**
 * Pure result-shaping helpers shared by the client wrapper (`wrap.ts`) and the
 * custom matchers (`matchers.ts`). They take a raw MCP result — or anything
 * result-shaped — and pull out the ergonomic views the old declarative runner
 * exposed: joined text, list names, a normalized boolean `isError`. Nothing
 * here imports vitest, so it stays trivially unit-testable.
 */

type Rec = Record<string, unknown>;

function asRecord(value: unknown): Rec | undefined {
  return value !== null && typeof value === "object" ? (value as Rec) : undefined;
}

/**
 * Join every text block found in a result into a single newline-separated
 * string, in document order. Handles all three result shapes a test asserts on:
 * tool `content[]`, resource `contents[]`, and prompt `messages[].content`.
 */
export function joinText(raw: unknown): string {
  const result = asRecord(raw);
  if (!result) return "";
  const parts: string[] = [];

  const content = result.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      const b = asRecord(block);
      if (b?.type === "text" && typeof b.text === "string") parts.push(b.text);
    }
  }

  const contents = result.contents;
  if (Array.isArray(contents)) {
    for (const entry of contents) {
      const c = asRecord(entry);
      if (c && typeof c.text === "string") parts.push(c.text);
    }
  }

  const messages = result.messages;
  if (Array.isArray(messages)) {
    for (const message of messages) {
      const c = asRecord(asRecord(message)?.content);
      if (c?.type === "text" && typeof c.text === "string") parts.push(c.text);
    }
  }

  return parts.join("\n");
}

/**
 * Pull the item names out of a list result, scanning the four list shapes
 * (`tools`/`resources`/`resourceTemplates`/`prompts`) and falling back to
 * `uri`/`uriTemplate` when an entry has no `name`. Returns `[]` for anything
 * that isn't a recognized list result.
 */
export function listNames(raw: unknown): string[] {
  const result = asRecord(raw);
  if (!result) return [];
  for (const key of ["tools", "resources", "resourceTemplates", "prompts"]) {
    const arr = result[key];
    if (Array.isArray(arr)) {
      return arr
        .map((item) => {
          const o = asRecord(item);
          const v = o?.name ?? o?.uri ?? o?.uriTemplate;
          return typeof v === "string" ? v : undefined;
        })
        .filter((v): v is string => v !== undefined);
    }
  }
  return [];
}

/** A tool result's error flag, normalized to a boolean (absent ⇒ `false`). */
export function coerceIsError(raw: unknown): boolean {
  return asRecord(raw)?.isError === true;
}
