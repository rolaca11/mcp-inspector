/**
 * Pretty-printers for the structured payloads MCP returns. The CLI also
 * supports `--json` on every command, which bypasses these and dumps the raw
 * JSON-RPC result instead.
 */

import pc from "picocolors";

export interface FormatOptions {
  /** Print machine-readable JSON only. */
  json?: boolean;
  /** Force colored output even when stdout is not a TTY. */
  color?: boolean;
}

export function shouldUseColor(opts: FormatOptions): boolean {
  if (opts.color) return true;
  if (opts.json) return false;
  return process.stdout.isTTY === true;
}

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

/* ------------------------------------------------------------------ */
/* Resources & resource templates                                      */
/* ------------------------------------------------------------------ */

interface ResourceLike {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  title?: string;
  size?: number;
}

export function printResources(resources: ResourceLike[], opts: FormatOptions = {}) {
  if (opts.json) return printJson(resources);
  if (resources.length === 0) {
    console.log(pc.dim("No resources."));
    return;
  }
  console.log(pc.bold(`Resources (${resources.length}):`));
  for (const r of resources) {
    const title = r.title ?? r.name;
    console.log(`  ${pc.cyan(r.uri)}`);
    console.log(`    ${pc.bold(title)}${r.mimeType ? pc.dim(`  [${r.mimeType}]`) : ""}`);
    if (r.description) console.log(`    ${pc.dim(r.description)}`);
    if (r.size != null) console.log(`    ${pc.dim(`size: ${r.size} bytes`)}`);
  }
}

interface ResourceTemplateLike {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
  title?: string;
}

export function printResourceTemplates(
  templates: ResourceTemplateLike[],
  opts: FormatOptions = {},
) {
  if (opts.json) return printJson(templates);
  if (templates.length === 0) {
    console.log(pc.dim("No resource templates."));
    return;
  }
  console.log(pc.bold(`Resource templates (${templates.length}):`));
  for (const t of templates) {
    const title = t.title ?? t.name;
    console.log(`  ${pc.cyan(t.uriTemplate)}`);
    console.log(`    ${pc.bold(title)}${t.mimeType ? pc.dim(`  [${t.mimeType}]`) : ""}`);
    if (t.description) console.log(`    ${pc.dim(t.description)}`);
    const vars = extractTemplateVars(t.uriTemplate);
    if (vars.length) {
      console.log(`    ${pc.dim(`vars: ${vars.join(", ")}`)}`);
    }
  }
}

/** Pull `{name}` placeholders out of an RFC 6570 URI template. */
export function extractTemplateVars(template: string): string[] {
  const out: string[] = [];
  // Match {x}, {?a,b}, {/a*}, {+a}, etc. then grab plain comma-separated names.
  for (const match of template.matchAll(/\{([^}]+)\}/g)) {
    const inner = match[1] ?? "";
    const stripped = inner.replace(/^[+#./;?&]/, ""); // operator
    for (const part of stripped.split(",")) {
      const name = part.replace(/[*:].*$/, "").trim(); // explode/prefix modifiers
      if (name) out.push(name);
    }
  }
  return Array.from(new Set(out));
}

/* ------------------------------------------------------------------ */
/* Resource read result                                                */
/* ------------------------------------------------------------------ */

interface TextContents {
  uri: string;
  mimeType?: string;
  text: string;
}

interface BlobContents {
  uri: string;
  mimeType?: string;
  blob: string; // base64
}

export function printResourceContents(
  contents: Array<TextContents | BlobContents>,
  opts: FormatOptions = {},
) {
  if (opts.json) return printJson(contents);
  if (contents.length === 0) {
    console.log(pc.dim("No content."));
    return;
  }
  for (const [i, c] of contents.entries()) {
    if (i > 0) console.log();
    const header = `${pc.cyan(c.uri)}${c.mimeType ? pc.dim(`  [${c.mimeType}]`) : ""}`;
    console.log(header);
    console.log(pc.dim("─".repeat(Math.min(60, header.length))));
    if ("text" in c) {
      console.log(c.text);
    } else {
      console.log(pc.dim(`<binary, base64, ${c.blob.length} chars>`));
    }
  }
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

interface ToolLike {
  name: string;
  description?: string;
  inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
  outputSchema?: unknown;
  title?: string;
}

export function printTools(tools: ToolLike[], opts: FormatOptions = {}) {
  if (opts.json) return printJson(tools);
  if (tools.length === 0) {
    console.log(pc.dim("No tools."));
    return;
  }
  console.log(pc.bold(`Tools (${tools.length}):`));
  for (const t of tools) {
    const title = t.title ?? t.name;
    console.log(`  ${pc.green(t.name)}${title !== t.name ? `  ${pc.dim(`(${title})`)}` : ""}`);
    if (t.description) console.log(`    ${pc.dim(t.description)}`);
    const props = (t.inputSchema?.properties ?? {}) as Record<string, { type?: string; description?: string }>;
    const required = new Set(t.inputSchema?.required ?? []);
    const names = Object.keys(props);
    if (names.length === 0) {
      console.log(`    ${pc.dim("(no parameters)")}`);
    } else {
      console.log(`    ${pc.dim("params:")}`);
      for (const name of names) {
        const spec = props[name] ?? {};
        const typeStr = spec.type ?? "any";
        const reqStr = required.has(name) ? pc.yellow("required") : pc.dim("optional");
        const desc = spec.description ? `  ${pc.dim(`— ${spec.description}`)}` : "";
        console.log(`      ${name} ${pc.dim(`<${typeStr}>`)} ${reqStr}${desc}`);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Tool call result                                                    */
/* ------------------------------------------------------------------ */

interface CallToolResult {
  content: ContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "resource_link"; uri: string; name?: string; description?: string; mimeType?: string }
  | {
      type: "resource";
      resource:
        | { uri: string; mimeType?: string; text: string }
        | { uri: string; mimeType?: string; blob: string };
    };

export function printToolResult(result: CallToolResult, opts: FormatOptions = {}) {
  if (opts.json) return printJson(result);

  if (result.isError) {
    console.log(pc.red(pc.bold("Tool returned isError=true")));
  }

  // Per the MCP spec, when a tool returns `structuredContent`, the `content`
  // blocks are a human-readable serialization of the same data, included for
  // backwards compatibility with clients that can't parse the structured
  // payload. Show the structured payload only and skip the duplicate prose.
  const hasStructured =
    result.structuredContent && Object.keys(result.structuredContent).length > 0;

  if (hasStructured) {
    console.log(pc.bold("structuredContent:"));
    console.log(JSON.stringify(result.structuredContent, null, 2));
  } else {
    printContentBlocks(result.content);
  }
}

export function printContentBlocks(content: ContentBlock[]): void {
  for (const [i, block] of content.entries()) {
    if (i > 0) console.log();
    switch (block.type) {
      case "text":
        console.log(block.text);
        break;
      case "image":
        console.log(pc.dim(`<image ${block.mimeType}, ${block.data.length} base64 chars>`));
        break;
      case "audio":
        console.log(pc.dim(`<audio ${block.mimeType}, ${block.data.length} base64 chars>`));
        break;
      case "resource_link":
        console.log(`${pc.cyan(block.uri)}${block.name ? `  ${pc.bold(block.name)}` : ""}`);
        if (block.description) console.log(pc.dim(block.description));
        break;
      case "resource": {
        const r = block.resource;
        console.log(`${pc.cyan(r.uri)}${r.mimeType ? pc.dim(`  [${r.mimeType}]`) : ""}`);
        if ("text" in r) console.log(r.text);
        else console.log(pc.dim(`<binary blob, ${r.blob.length} base64 chars>`));
        break;
      }
      default:
        console.log(pc.dim(`<unknown content type: ${(block as { type: string }).type}>`));
    }
  }
}

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

interface PromptLike {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  title?: string;
}

export function printPrompts(prompts: PromptLike[], opts: FormatOptions = {}) {
  if (opts.json) return printJson(prompts);
  if (prompts.length === 0) {
    console.log(pc.dim("No prompts."));
    return;
  }
  console.log(pc.bold(`Prompts (${prompts.length}):`));
  for (const p of prompts) {
    const title = p.title ?? p.name;
    console.log(`  ${pc.magenta(p.name)}${title !== p.name ? `  ${pc.dim(`(${title})`)}` : ""}`);
    if (p.description) console.log(`    ${pc.dim(p.description)}`);
    const args = p.arguments ?? [];
    if (args.length === 0) {
      console.log(`    ${pc.dim("(no arguments)")}`);
    } else {
      console.log(`    ${pc.dim("args:")}`);
      for (const a of args) {
        const reqStr = a.required ? pc.yellow("required") : pc.dim("optional");
        const desc = a.description ? `  ${pc.dim(`— ${a.description}`)}` : "";
        console.log(`      ${a.name} ${reqStr}${desc}`);
      }
    }
  }
}

interface GetPromptResult {
  description?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: ContentBlock;
  }>;
}

export function printPromptResult(result: GetPromptResult, opts: FormatOptions = {}) {
  if (opts.json) return printJson(result);
  if (result.description) {
    console.log(pc.dim(result.description));
    console.log();
  }
  for (const [i, msg] of result.messages.entries()) {
    if (i > 0) console.log();
    const roleColor = msg.role === "user" ? pc.blue : pc.green;
    console.log(roleColor(pc.bold(`${msg.role}:`)));
    printContentBlocks([msg.content]);
  }
}

/* ------------------------------------------------------------------ */
/* Completions                                                         */
/* ------------------------------------------------------------------ */

interface CompleteResult {
  completion: { values: string[]; total?: number; hasMore?: boolean };
}

export function printCompletions(result: CompleteResult, opts: FormatOptions = {}) {
  if (opts.json) return printJson(result);
  const { values, total, hasMore } = result.completion;
  if (values.length === 0) {
    console.log(pc.dim("No completions."));
    return;
  }
  const totalStr = total != null ? `${values.length}/${total}` : `${values.length}`;
  const moreStr = hasMore ? pc.yellow(" (more available)") : "";
  console.log(pc.bold(`Completions (${totalStr})${moreStr}:`));
  for (const v of values) {
    console.log(`  ${v}`);
  }
}
