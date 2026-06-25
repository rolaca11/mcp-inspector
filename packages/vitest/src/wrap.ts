/**
 * `wrap()` turns a live MCP `Session` into an `McpClient`: a thin, typed façade
 * whose methods each perform one MCP call and return a result object with
 * ergonomic accessors layered over the untouched SDK result (`.raw`). It is
 * pure — no vitest, no global state — so it is reusable anywhere a `Session`
 * exists, and the per-kind result builders are exported for direct use.
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  CallToolResult,
  CompleteResult,
  ContentBlock,
  GetPromptResult,
  ListPromptsResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListToolsResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";

import type { Session } from "@rolaca11/mcp-inspector-core/client";
import { coerceIsError, joinText, listNames } from "./normalize.js";

/** Escape hatch carried by every wrapped result: the untouched SDK payload. */
export interface Probed<TRaw> {
  readonly raw: TRaw;
}

export interface ToolResult extends Probed<CallToolResult> {
  /** `true` when the tool reported a failure (absent in the result ⇒ `false`). */
  readonly isError: boolean;
  /** Every text block joined by newlines. */
  readonly text: string;
  /** The content blocks (empty array when the tool returned none). */
  readonly content: readonly ContentBlock[];
  /** The structured payload, if the tool returned one. */
  readonly structuredContent: unknown;
  /** First content block of the given type, narrowed on its discriminant. */
  block<K extends ContentBlock["type"]>(
    type: K,
  ): Extract<ContentBlock, { type: K }> | undefined;
  /** `structuredContent` if present, otherwise `text` parsed as JSON. */
  json<T = unknown>(): T;
}

export interface ResourceResult extends Probed<ReadResourceResult> {
  /** Every `contents[].text` joined by newlines. */
  readonly text: string;
  readonly contents: ReadResourceResult["contents"];
  /** First content entry's MIME type, if any. */
  readonly mimeType: string | undefined;
  /** First content entry's base64 blob, when it's a binary resource. */
  readonly blob: string | undefined;
  /** `text` parsed as JSON. */
  json<T = unknown>(): T;
}

export interface PromptResult extends Probed<GetPromptResult> {
  /** Every text-content message joined by newlines. */
  readonly text: string;
  readonly messages: GetPromptResult["messages"];
  /** The role of each message, in order. */
  readonly roles: readonly string[];
}

export interface ListResult<TRaw> extends Probed<TRaw> {
  /** Names of the listed items (falls back to `uri` / `uriTemplate`). */
  readonly names: readonly string[];
}

export interface CompletionResult extends Probed<CompleteResult> {
  readonly values: readonly string[];
  readonly total: number | undefined;
  readonly hasMore: boolean;
}

/** A typed façade over a single MCP session. Returned by `wrap()`. */
export interface McpClient {
  /** The underlying session (its lifecycle is owned by whoever created it). */
  readonly session: Session;
  /** The raw SDK client — for anything this façade doesn't wrap. */
  readonly client: Client;
  callTool(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
  readResource(uri: string): Promise<ResourceResult>;
  getPrompt(name: string, args?: Record<string, string>): Promise<PromptResult>;
  listTools(): Promise<ListResult<ListToolsResult>>;
  listResources(): Promise<ListResult<ListResourcesResult>>;
  listResourceTemplates(): Promise<ListResult<ListResourceTemplatesResult>>;
  listPrompts(): Promise<ListResult<ListPromptsResult>>;
  complete(params: Parameters<Client["complete"]>[0]): Promise<CompletionResult>;
  ping(): Promise<void>;
}

function parseJson<T>(structured: unknown, text: string): T {
  if (structured !== undefined) return structured as T;
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`result text is not valid JSON: ${(e as Error).message}`);
  }
}

export function toolResult(raw: CallToolResult): ToolResult {
  const content: ContentBlock[] = raw.content ?? [];
  return {
    raw,
    isError: coerceIsError(raw),
    text: joinText(raw),
    content,
    structuredContent: raw.structuredContent,
    block<K extends ContentBlock["type"]>(type: K) {
      return content.find(
        (b): b is Extract<ContentBlock, { type: K }> => b.type === type,
      );
    },
    json<T = unknown>() {
      return parseJson<T>(raw.structuredContent, joinText(raw));
    },
  };
}

export function resourceResult(raw: ReadResourceResult): ResourceResult {
  const first = raw.contents[0];
  return {
    raw,
    text: joinText(raw),
    contents: raw.contents,
    mimeType: first?.mimeType,
    blob: first && "blob" in first ? first.blob : undefined,
    json<T = unknown>() {
      return parseJson<T>(undefined, joinText(raw));
    },
  };
}

export function promptResult(raw: GetPromptResult): PromptResult {
  return {
    raw,
    text: joinText(raw),
    messages: raw.messages,
    roles: raw.messages.map((m) => m.role),
  };
}

export function completionResult(raw: CompleteResult): CompletionResult {
  return {
    raw,
    values: raw.completion.values,
    total: raw.completion.total,
    hasMore: raw.completion.hasMore ?? false,
  };
}

function listResult<TRaw>(raw: TRaw): ListResult<TRaw> {
  return { raw, names: listNames(raw) };
}

/** Wrap a live session into the ergonomic, typed client used across tests. */
export function wrap(session: Session): McpClient {
  const client = session.client;
  return {
    session,
    client,
    async callTool(name, args) {
      // callTool's static return type is the compatibility union; the default
      // result schema is CallToolResult, so this narrowing cast is sound.
      const raw = (await client.callTool({
        name,
        arguments: args ?? {},
      })) as CallToolResult;
      return toolResult(raw);
    },
    async readResource(uri) {
      return resourceResult(await client.readResource({ uri }));
    },
    async getPrompt(name, args) {
      return promptResult(
        await client.getPrompt({ name, arguments: args ?? {} }),
      );
    },
    async listTools() {
      return listResult(await client.listTools());
    },
    async listResources() {
      return listResult(await client.listResources());
    },
    async listResourceTemplates() {
      return listResult(await client.listResourceTemplates());
    },
    async listPrompts() {
      return listResult(await client.listPrompts());
    },
    async complete(params) {
      return completionResult(await client.complete(params));
    },
    async ping() {
      await client.ping();
    },
  };
}
