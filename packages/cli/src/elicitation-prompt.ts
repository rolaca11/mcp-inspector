import readline from "node:readline";
import pc from "picocolors";

import {
  describeElicitationForm,
  isRecord,
  validateElicitationField,
  validateElicitationFormContent,
  validateElicitationUrl,
  type ElicitationContent,
  type ElicitationContentValue,
  type ElicitationFormParams,
  type ElicitationHandler,
  type ElicitationHandlerContext,
  type ElicitationResult,
  type ElicitationUrlParams,
  type NormalizedElicitationField,
} from "@rolaca11/mcp-inspector-core/elicitation";
import { openInBrowser } from "@rolaca11/mcp-inspector-core/oauth";

export type AskLine = (prompt: string, opts?: { signal?: AbortSignal }) => Promise<string>;

export interface InteractiveElicitationOptions {
  askLine?: AskLine;
  output?: { write(chunk: string): unknown };
  openUrl?: (url: string) => void | Promise<void>;
}

const ACTIONS = new Set(["accept", "decline", "cancel"]);

function isContentValue(value: unknown): value is ElicitationContentValue {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every((v) => typeof v === "string"))
  );
}

function parseScriptedResult(value: unknown, label: string): ElicitationResult {
  if (!isRecord(value)) throw new Error(`${label} must be an object like {"action":"accept","content":{...}}`);
  if (typeof value.action !== "string" || !ACTIONS.has(value.action)) {
    throw new Error(`${label}.action must be "accept", "decline", or "cancel"`);
  }
  const action = value.action as ElicitationResult["action"];
  if (value.content === undefined) return { action };
  if (!isRecord(value.content)) throw new Error(`${label}.content must be an object`);
  for (const [key, v] of Object.entries(value.content)) {
    if (!isContentValue(v)) {
      throw new Error(`${label}.content.${key} must be a string, number, boolean, or array of strings`);
    }
  }
  return { action, content: value.content as ElicitationContent };
}

export function createScriptedElicitationHandler(rawJson: string): ElicitationHandler {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (e) {
    throw new Error(`--elicit-response must be valid JSON: ${(e as Error).message}`);
  }
  const repeat = !Array.isArray(parsed);
  const queue = Array.isArray(parsed)
    ? parsed.map((entry, i) => parseScriptedResult(entry, `--elicit-response[${i}]`))
    : [parseScriptedResult(parsed, "--elicit-response")];

  return async (params) => {
    const next = repeat ? queue[0] : queue.shift();
    if (!next) {
      throw new Error(`--elicit-response has no response left for elicitation "${params.message}"`);
    }
    if (next.action === "accept" && params.mode === "form") {
      const validation = validateElicitationFormContent(params.requestedSchema, next.content);
      if (!validation.ok) {
        const details = Object.entries(validation.errors)
          .map(([field, error]) => `${field}: ${error}`)
          .join("; ");
        throw new Error(`--elicit-response does not match the requested schema: ${details}`);
      }
      return { action: "accept", content: validation.content };
    }
    return next;
  };
}

export function createStdioAskLine(output: NodeJS.WritableStream = process.stderr): AskLine {
  return (prompt, opts = {}) =>
    new Promise<string>((resolve, reject) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output,
        terminal: process.stdin.isTTY === true && (output as { isTTY?: boolean }).isTTY === true,
      });
      let answered = false;
      const onAbort = () => {
        rl.close();
        reject(opts.signal?.reason ?? new Error("Elicitation was cancelled"));
      };
      const cleanup = () => opts.signal?.removeEventListener("abort", onAbort);
      rl.once("close", () => {
        cleanup();
        if (!answered) reject(new Error("input closed"));
      });
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      rl.question(prompt, opts.signal ? { signal: opts.signal } : {}, (answer) => {
        answered = true;
        cleanup();
        rl.close();
        resolve(answer);
      });
    });
}

class ElicitationCancelled extends Error {
  readonly action: "decline" | "cancel";
  constructor(action: "decline" | "cancel") {
    super(action);
    this.action = action;
  }
}

function describeConstraints(field: NormalizedElicitationField): string {
  const parts: string[] = [];
  if (field.kind === "integer") parts.push("whole number");
  if (field.kind === "number") parts.push("number");
  if (field.kind === "boolean") parts.push("y/n");
  if (field.format) parts.push(field.format === "date" ? "YYYY-MM-DD" : field.format);
  if (field.minLength !== undefined) parts.push(`min ${field.minLength} chars`);
  if (field.maxLength !== undefined) parts.push(`max ${field.maxLength} chars`);
  if (field.minimum !== undefined) parts.push(`>= ${field.minimum}`);
  if (field.maximum !== undefined) parts.push(`<= ${field.maximum}`);
  if (field.kind === "multi-enum") parts.push("comma-separated");
  if (field.minItems !== undefined) parts.push(`at least ${field.minItems}`);
  if (field.maxItems !== undefined) parts.push(`at most ${field.maxItems}`);
  return parts.join(", ");
}

function formatDefault(value: ElicitationContentValue): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function pickOption(field: NormalizedElicitationField, token: string): string | null {
  const options = field.options ?? [];
  if (/^\d+$/.test(token)) {
    const option = options[Number(token) - 1];
    if (option) return option.value;
  }
  const lower = token.toLowerCase();
  const match =
    options.find((o) => o.value === token) ??
    options.find((o) => o.value.toLowerCase() === lower || o.label.toLowerCase() === lower);
  return match ? match.value : null;
}

function parseAnswer(
  field: NormalizedElicitationField,
  answer: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = answer.trim();
  if (trimmed === "") return { ok: true, value: undefined };
  switch (field.kind) {
    case "boolean": {
      const lower = trimmed.toLowerCase();
      if (["y", "yes", "true", "1"].includes(lower)) return { ok: true, value: true };
      if (["n", "no", "false", "0"].includes(lower)) return { ok: true, value: false };
      return { ok: false, error: "Answer yes or no" };
    }
    case "number":
    case "integer": {
      const value = Number(trimmed);
      if (!Number.isFinite(value)) return { ok: false, error: "Expected a number" };
      return { ok: true, value };
    }
    case "single-enum": {
      const value = pickOption(field, trimmed);
      return value === null ? { ok: false, error: `"${trimmed}" is not one of the options` } : { ok: true, value };
    }
    case "multi-enum": {
      const values: string[] = [];
      for (const token of trimmed.split(",").map((t) => t.trim()).filter(Boolean)) {
        const value = pickOption(field, token);
        if (value === null) return { ok: false, error: `"${token}" is not one of the options` };
        values.push(value);
      }
      return { ok: true, value: values };
    }
    case "string":
      return { ok: true, value: answer };
  }
}

export function createInteractiveElicitationHandler(
  options: InteractiveElicitationOptions = {},
): ElicitationHandler {
  const output = options.output ?? process.stderr;
  const askLine = options.askLine ?? createStdioAskLine();
  const openUrl = options.openUrl ?? ((url: string) => openInBrowser(new URL(url)));
  const write = (line = "") => output.write(`${line}\n`);
  let queue: Promise<unknown> = Promise.resolve();

  async function ask(prompt: string, ctx: ElicitationHandlerContext): Promise<string> {
    if (ctx.signal?.aborted) throw ctx.signal.reason ?? new Error("Elicitation was cancelled");
    return askLine(prompt, ctx.signal ? { signal: ctx.signal } : {});
  }

  async function chooseAction(
    prompt: string,
    choices: Record<string, string>,
    fallback: string | null,
    ctx: ElicitationHandlerContext,
  ): Promise<string> {
    for (;;) {
      const answer = (await ask(prompt, ctx)).trim().toLowerCase();
      if (answer === "" && fallback !== null) return fallback;
      const choice = choices[answer];
      if (choice) return choice;
      write(pc.yellow(`  Please answer one of: ${Object.keys(choices).join(", ")}`));
    }
  }

  async function askField(field: NormalizedElicitationField, ctx: ElicitationHandlerContext) {
    const marker = field.required ? pc.red("*") : "";
    write(`${pc.bold(field.label)}${marker}${field.description ? pc.dim(` ${field.description}`) : ""}`);
    if (field.options && field.options.length > 0) {
      field.options.forEach((option, i) => {
        const value = option.label === option.value ? "" : pc.dim(` (${option.value})`);
        write(`  ${pc.cyan(String(i + 1))}. ${option.label}${value}`);
      });
    }
    const hints = [describeConstraints(field)];
    if (field.default !== undefined) hints.push(`default: ${formatDefault(field.default)}`);
    const hint = hints.filter(Boolean).join("; ");
    const prompt = `  ${field.label}${hint ? pc.dim(` [${hint}]`) : ""}: `;

    for (;;) {
      const answer = await ask(prompt, ctx);
      const command = answer.trim().toLowerCase();
      if (command === ":decline") throw new ElicitationCancelled("decline");
      if (command === ":cancel") throw new ElicitationCancelled("cancel");
      const parsed = parseAnswer(field, answer);
      if (!parsed.ok) {
        write(pc.yellow(`  ${parsed.error}`));
        continue;
      }
      const validated = validateElicitationField(field, parsed.value);
      if (!validated.ok) {
        write(pc.yellow(`  ${validated.error}`));
        continue;
      }
      return validated.value;
    }
  }

  async function handleForm(
    params: ElicitationFormParams,
    ctx: ElicitationHandlerContext,
  ): Promise<ElicitationResult> {
    const fields = describeElicitationForm(params.requestedSchema);
    write();
    write(`${pc.magenta("?")} ${pc.bold("The server is asking for input")}`);
    write(`  ${params.message}`);
    const action = await chooseAction(
      `  Respond? ${pc.dim("[Y]es / (d)ecline / (c)ancel")} `,
      { y: "accept", yes: "accept", d: "decline", decline: "decline", c: "cancel", cancel: "cancel" },
      "accept",
      ctx,
    );
    if (action !== "accept") return { action: action as "decline" | "cancel" };
    if (fields.length > 0) {
      write(pc.dim("  Leave a field empty to skip it or use its default. Type :decline or :cancel to stop."));
    }

    const content: ElicitationContent = {};
    try {
      for (const field of fields) {
        const value = await askField(field, ctx);
        if (value !== undefined) content[field.name] = value;
      }
    } catch (e) {
      if (e instanceof ElicitationCancelled) return { action: e.action };
      throw e;
    }
    return { action: "accept", content };
  }

  async function handleUrl(
    params: ElicitationUrlParams,
    ctx: ElicitationHandlerContext,
  ): Promise<ElicitationResult> {
    write();
    write(`${pc.magenta("?")} ${pc.bold("The server wants you to open a URL")}`);
    write(`  ${params.message}`);
    const check = validateElicitationUrl(params.url);
    if (!check.valid) {
      write(pc.red(`  Refusing to open ${JSON.stringify(params.url)}: ${check.reason}`));
      return { action: "decline" };
    }
    write(`  ${pc.dim("site:")} ${pc.bold(pc.yellow(check.host))}  ${pc.dim(`(${check.origin})`)}`);
    write(`  ${pc.dim("url:")}  ${pc.cyan(check.url.toString())}`);
    if (params.elicitationId) write(`  ${pc.dim("id:")}   ${params.elicitationId}`);
    const action = await chooseAction(
      `  ${pc.dim("(o)pen in browser / (a)ccept, I'll open it myself / (d)ecline / (c)ancel")} `,
      {
        o: "open",
        open: "open",
        a: "accept",
        accept: "accept",
        d: "decline",
        decline: "decline",
        c: "cancel",
        cancel: "cancel",
      },
      null,
      ctx,
    );
    if (action === "decline" || action === "cancel") return { action };
    if (action === "open") {
      try {
        await openUrl(check.url.toString());
      } catch {
        write(pc.yellow("  Could not open a browser; visit the URL above manually."));
      }
    }
    return { action: "accept" };
  }

  return (params, ctx) => {
    const run = queue.then(async (): Promise<ElicitationResult> => {
      try {
        return params.mode === "url" ? await handleUrl(params, ctx) : await handleForm(params, ctx);
      } catch (e) {
        if (ctx.signal?.aborted) throw e;
        if (e instanceof Error && e.message === "input closed") return { action: "cancel" };
        throw e;
      }
    });
    queue = run.catch(() => {});
    return run;
  };
}

export interface CliElicitationFlags {
  elicitation?: boolean;
  elicitResponse?: string;
}

export function resolveCliElicitationHandler(
  flags: CliElicitationFlags,
  options: InteractiveElicitationOptions & { interactive?: boolean } = {},
): ElicitationHandler | undefined {
  if (flags.elicitation === false) return undefined;
  if (flags.elicitResponse !== undefined) return createScriptedElicitationHandler(flags.elicitResponse);
  const { interactive, ...prompt } = options;
  if (!(interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true))) return undefined;
  return createInteractiveElicitationHandler(prompt);
}
