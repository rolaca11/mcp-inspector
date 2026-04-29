/**
 * Pure "do one thing" functions that operate on an open MCP session and
 * print to stdout/stderr. These are the building blocks both the CLI
 * subcommands and the interactive REPL invoke — keeping the behavior in
 * one place means scripted (`mcp-inspector tools list ...`) and interactive
 * (`mcpi> tools`) modes stay in lock-step.
 */

import pc from "picocolors";
import { promises as fs } from "node:fs";

import type { Session } from "./client.js";
import {
  printCompletions,
  printJson,
  printPromptResult,
  printPrompts,
  printResourceContents,
  printResourceTemplates,
  printResources,
  printToolResult,
  printTokenCount,
  printTools,
  type FormatOptions,
} from "./format.js";
import { authFile } from "./paths.js";
import { targetId, type TargetSpec } from "./target.js";
import { countResponseTokens } from "./tokens.js";

/**
 * Shared helper: count tokens for a payload and either print JSON
 * (`{ _tokenCount }`) or the human-readable line + warning.
 */
function emitTokenCount(payload: unknown, opts: FormatOptions): void {
  const result = countResponseTokens(payload);
  if (opts.json) {
    printJson({ _tokenCount: result.ok ? result.tokens : null, ...(result.ok ? {} : { _tokenCountError: result.error }) });
  } else {
    printTokenCount(result);
  }
}

/* ------------------------------------------------------------------ */
/* Discover                                                            */
/* ------------------------------------------------------------------ */

export async function discover(session: Session, opts: FormatOptions = {}) {
  const caps = session.client.getServerCapabilities() ?? {};
  const info = session.client.getServerVersion();

  const [resources, templates, tools, prompts] = await Promise.all([
    caps.resources ? safeList(() => session.client.listResources()) : { resources: [] as ResourceLike[] },
    caps.resources ? safeList(() => session.client.listResourceTemplates()) : { resourceTemplates: [] as ResourceTemplateLike[] },
    caps.tools ? safeList(() => session.client.listTools()) : { tools: [] as ToolLike[] },
    caps.prompts ? safeList(() => session.client.listPrompts()) : { prompts: [] as PromptLike[] },
  ]);

  if (opts.json) {
    printJson({
      server: info,
      capabilities: caps,
      resources: resources.resources,
      resourceTemplates: templates.resourceTemplates,
      tools: tools.tools,
      prompts: prompts.prompts,
    });
    return;
  }

  if (info) {
    console.log(
      pc.bold(`Server: ${info.name}${info.version ? ` ${pc.dim(info.version)}` : ""}`),
    );
  }
  const enabled = Object.entries(caps)
    .filter(([, v]) => v != null)
    .map(([k]) => k);
  if (enabled.length) {
    console.log(pc.dim(`Capabilities: ${enabled.join(", ")}`));
  }
  console.log();

  printResources(resources.resources, opts);
  console.log();
  printResourceTemplates(templates.resourceTemplates, opts);
  console.log();
  printTools(tools.tools, opts);
  console.log();
  printPrompts(prompts.prompts, opts);
  if (opts.countTokens) {
    const payload = { resources, templates, tools, prompts };
    emitTokenCount(payload, opts);
  }
}

/* ------------------------------------------------------------------ */
/* Resources                                                           */
/* ------------------------------------------------------------------ */

export async function listResources(session: Session, opts: FormatOptions = {}) {
  const result = await session.client.listResources();
  printResources(result.resources, opts);
  if (opts.countTokens) emitTokenCount(result, opts);
}

export async function listResourceTemplates(session: Session, opts: FormatOptions = {}) {
  const result = await session.client.listResourceTemplates();
  printResourceTemplates(result.resourceTemplates, opts);
  if (opts.countTokens) emitTokenCount(result, opts);
}

export async function readResource(
  session: Session,
  uri: string,
  opts: FormatOptions = {},
) {
  const result = await session.client.readResource({ uri });
  printResourceContents(result.contents, opts);
  if (opts.countTokens) emitTokenCount(result, opts);
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

export async function listTools(session: Session, opts: FormatOptions = {}) {
  const result = await session.client.listTools();
  printTools(result.tools, opts);
  if (opts.countTokens) emitTokenCount(result, opts);
}

export interface CallToolArgs {
  name: string;
  arguments?: Record<string, unknown>;
}

export async function callTool(
  session: Session,
  args: CallToolArgs,
  opts: FormatOptions = {},
) {
  const result = await session.client.callTool({
    name: args.name,
    arguments: args.arguments ?? {},
  });
  printToolResult(result as Parameters<typeof printToolResult>[0], opts);
  if (opts.countTokens) emitTokenCount(result, opts);
}

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

export async function listPrompts(session: Session, opts: FormatOptions = {}) {
  const result = await session.client.listPrompts();
  printPrompts(result.prompts, opts);
  if (opts.countTokens) emitTokenCount(result, opts);
}

export async function getPrompt(
  session: Session,
  name: string,
  args: Record<string, string>,
  opts: FormatOptions = {},
) {
  const result = await session.client.getPrompt({ name, arguments: args });
  printPromptResult(result as Parameters<typeof printPromptResult>[0], opts);
  if (opts.countTokens) emitTokenCount(result, opts);
}

/* ------------------------------------------------------------------ */
/* Completions                                                         */
/* ------------------------------------------------------------------ */

export interface CompleteArgs {
  refType: "prompt" | "resource";
  /** Prompt name OR resource template URI. */
  ref: string;
  /** Argument name (or template variable name) being completed. */
  argument: string;
  /** Partial value typed so far (may be empty for "list everything"). */
  value?: string;
  /** Already-resolved sibling arguments, for cascading completion. */
  context?: Record<string, string>;
}

export async function complete(
  session: Session,
  args: CompleteArgs,
  opts: FormatOptions = {},
) {
  const ref =
    args.refType === "prompt"
      ? { type: "ref/prompt" as const, name: args.ref }
      : { type: "ref/resource" as const, uri: args.ref };

  const params: {
    ref: typeof ref;
    argument: { name: string; value: string };
    context?: { arguments: Record<string, string> };
  } = {
    ref,
    argument: { name: args.argument, value: args.value ?? "" },
  };
  if (args.context && Object.keys(args.context).length > 0) {
    params.context = { arguments: args.context };
  }
  const result = await session.client.complete(params);
  printCompletions(result, opts);
  if (opts.countTokens) emitTokenCount(result, opts);
}

/* ------------------------------------------------------------------ */
/* Auth (does not require an open session)                             */
/* ------------------------------------------------------------------ */

export async function authStatus(target: TargetSpec, opts: FormatOptions = {}) {
  const id = targetId(target);
  const file = authFile(id);
  let info: {
    file: string;
    exists: boolean;
    hasTokens?: boolean;
    hasRefreshToken?: boolean;
    hasClientInfo?: boolean;
    tokenType?: string;
    scope?: string;
  } = { file, exists: false };

  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as {
      tokens?: { token_type?: string; refresh_token?: string; scope?: string };
      clientInformation?: unknown;
    };
    info = {
      file,
      exists: true,
      hasTokens: !!parsed.tokens,
      hasRefreshToken: !!parsed.tokens?.refresh_token,
      hasClientInfo: !!parsed.clientInformation,
      ...(parsed.tokens?.token_type ? { tokenType: parsed.tokens.token_type } : {}),
      ...(parsed.tokens?.scope ? { scope: parsed.tokens.scope } : {}),
    };
  } catch (e) {
    if (!isENOENT(e)) throw e;
  }

  if (opts.json) return printJson(info);

  console.log(pc.bold(`Auth status for ${target.raw}:`));
  console.log(`  ${pc.dim("file:")} ${info.file}`);
  if (!info.exists) {
    console.log(`  ${pc.dim("status:")} ${pc.yellow("not authenticated")}`);
    return;
  }
  console.log(`  ${pc.dim("tokens:")} ${info.hasTokens ? pc.green("yes") : pc.yellow("no")}`);
  console.log(`  ${pc.dim("refresh token:")} ${info.hasRefreshToken ? pc.green("yes") : pc.dim("no")}`);
  console.log(`  ${pc.dim("registered client:")} ${info.hasClientInfo ? pc.green("yes") : pc.dim("no")}`);
  if (info.tokenType) console.log(`  ${pc.dim("token type:")} ${info.tokenType}`);
  if (info.scope) console.log(`  ${pc.dim("scope:")} ${info.scope}`);
}

export async function authLogout(target: TargetSpec, opts: FormatOptions = {}) {
  const id = targetId(target);
  const file = authFile(id);
  try {
    await fs.unlink(file);
    if (opts.json) return printJson({ removed: true, file });
    console.log(pc.green(`Removed ${file}`));
  } catch (e) {
    if (isENOENT(e)) {
      if (opts.json) return printJson({ removed: false, file });
      console.log(pc.dim(`No auth on file for ${target.raw}`));
      return;
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface ResourceLike {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  title?: string;
  size?: number;
}
interface ResourceTemplateLike {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
  title?: string;
}
interface ToolLike {
  name: string;
  description?: string;
  inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
  outputSchema?: unknown;
  title?: string;
}
interface PromptLike {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  title?: string;
}

async function safeList<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    // Server advertised the capability but the call still failed (e.g. method
    // not found in an old SDK). Surface the error softly so the rest of the
    // discover output is still useful.
    console.error(pc.yellow(`(skipped: ${(e as Error).message})`));
    return {} as T;
  }
}

function isENOENT(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "ENOENT"
  );
}
