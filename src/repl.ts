/**
 * Interactive REPL for an open MCP session. Each line of input is parsed
 * with shell-quote and routed to the same `actions.ts` functions the
 * non-interactive CLI uses.
 */

import readline from "node:readline";
import { parse as shellParse } from "shell-quote";
import pc from "picocolors";

import * as actions from "./actions.js";
import { extractTemplateVars } from "./format.js";
import type { Session } from "./client.js";

const HELP = `
${pc.bold("Available commands:")}

  ${pc.cyan("discover")}                                     Show server info, capabilities, all primitives
  ${pc.cyan("server")}                                       Show server info & capabilities only

  ${pc.cyan("resources")}                                    List resources
  ${pc.cyan("templates")}                                    List resource templates
  ${pc.cyan("read")} <uri>                                   Read a resource

  ${pc.cyan("tools")}                                        List tools
  ${pc.cyan("call")} <name> [json-args]                      Call a tool. Args = JSON object.

  ${pc.cyan("prompts")}                                      List prompts
  ${pc.cyan("prompt")} <name> [json-args]                    Get a prompt. Args = JSON object of strings.

  ${pc.cyan("complete prompt")} <name> <arg> [partial]       Completions for a prompt argument
  ${pc.cyan("complete resource")} <uri-template> <var> [val] Completions for a resource-template variable

  ${pc.cyan("json on|off")}                                  Toggle JSON output mode (default: off)
  ${pc.cyan("help")} | ${pc.cyan("?")}                                       Show this help
  ${pc.cyan("quit")} | ${pc.cyan("exit")}                                    Disconnect and exit
`;

export interface ReplState {
  json: boolean;
}

export async function runRepl(session: Session): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdout.isTTY === true,
    completer: makeCompleter(session),
    historySize: 200,
  });

  const state: ReplState = { json: false };

  // Introduce the session.
  const info = session.client.getServerVersion();
  if (info) {
    console.log(
      pc.dim("connected to ") +
        pc.bold(info.name) +
        (info.version ? pc.dim(` ${info.version}`) : ""),
    );
  } else {
    console.log(pc.dim("connected"));
  }
  console.log(pc.dim('type "help" for commands, "quit" to exit'));

  rl.setPrompt(pc.bold(pc.cyan("mcpi> ")));
  rl.prompt();

  const lineHandler = async (raw: string) => {
    const line = raw.trim();
    if (!line) {
      rl.prompt();
      return;
    }
    rl.pause();
    try {
      const done = await dispatch(line, session, state);
      if (done) {
        rl.close();
        return;
      }
    } catch (e) {
      console.error(pc.red(`error: ${(e as Error).message}`));
    } finally {
      rl.resume();
      rl.prompt();
    }
  };
  rl.on("line", lineHandler);

  await new Promise<void>((resolve) => {
    rl.once("close", () => resolve());
  });
}

/**
 * Returns true when the user asked to quit.
 */
async function dispatch(
  line: string,
  session: Session,
  state: ReplState,
): Promise<boolean> {
  const tokens = shellParse(line).filter(
    (t): t is string => typeof t === "string",
  );
  if (tokens.length === 0) return false;
  const [cmd, ...args] = tokens as [string, ...string[]];

  const opts = { json: state.json };

  switch (cmd) {
    case "help":
    case "?":
      console.log(HELP);
      return false;

    case "quit":
    case "exit":
    case ".q":
      return true;

    case "json": {
      const v = args[0];
      if (v === "on") state.json = true;
      else if (v === "off") state.json = false;
      else console.log(`json mode is ${state.json ? "on" : "off"}`);
      return false;
    }

    case "server": {
      const info = session.client.getServerVersion();
      const caps = session.client.getServerCapabilities();
      if (state.json) {
        console.log(JSON.stringify({ server: info, capabilities: caps }, null, 2));
      } else {
        if (info)
          console.log(pc.bold(`${info.name}${info.version ? ` ${pc.dim(info.version)}` : ""}`));
        console.log(pc.dim("Capabilities:"), caps);
      }
      return false;
    }

    case "discover":
      await actions.discover(session, opts);
      return false;

    case "resources":
      await actions.listResources(session, opts);
      return false;

    case "templates":
      await actions.listResourceTemplates(session, opts);
      return false;

    case "read": {
      const uri = args[0];
      if (!uri) throw new Error("usage: read <uri>");
      await actions.readResource(session, uri, opts);
      return false;
    }

    case "tools":
      await actions.listTools(session, opts);
      return false;

    case "call": {
      const name = args[0];
      if (!name) throw new Error("usage: call <name> [json-args]");
      const json = args.slice(1).join(" ").trim();
      const parsed = json ? parseJsonObject(json, "call args") : {};
      await actions.callTool(session, { name, arguments: parsed }, opts);
      return false;
    }

    case "prompts":
      await actions.listPrompts(session, opts);
      return false;

    case "prompt": {
      const name = args[0];
      if (!name) throw new Error("usage: prompt <name> [json-args]");
      const json = args.slice(1).join(" ").trim();
      const parsed = json ? parseJsonObject(json, "prompt args") : {};
      const stringified: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        stringified[k] = typeof v === "string" ? v : JSON.stringify(v);
      }
      await actions.getPrompt(session, name, stringified, opts);
      return false;
    }

    case "complete": {
      const sub = args[0];
      if (sub !== "prompt" && sub !== "resource") {
        throw new Error("usage: complete <prompt|resource> <ref> <arg> [value]");
      }
      const ref = args[1];
      const argName = args[2];
      const value = args[3] ?? "";
      if (!ref || !argName) {
        throw new Error("usage: complete <prompt|resource> <ref> <arg> [value]");
      }
      await actions.complete(
        session,
        { refType: sub, ref, argument: argName, value },
        opts,
      );
      return false;
    }

    default:
      console.log(pc.yellow(`unknown command: ${cmd}`));
      console.log(pc.dim('type "help" for commands'));
      return false;
  }
}

/**
 * Tab completion. Completes the first token (verbs) and tries to be helpful
 * for the second token of `read`/`call`/`prompt`/`complete` by listing live
 * names from the server.
 *
 * Note: readline's completer is sync, so we lean on a small in-memory cache
 * that's populated lazily. The first tab on a new verb may show nothing —
 * pressing tab again after the cache fills works.
 */
function makeCompleter(session: Session) {
  const cache: {
    resources?: string[];
    resourceTemplates?: string[];
    tools?: string[];
    prompts?: string[];
  } = {};

  // Kick off background discovery; completer just reads the cache.
  const caps = session.client.getServerCapabilities() ?? {};
  if (caps.resources) {
    void session.client.listResources().then((r) => {
      cache.resources = r.resources.map((x) => x.uri);
    }).catch(() => {});
    void session.client.listResourceTemplates().then((r) => {
      cache.resourceTemplates = r.resourceTemplates.map((x) => x.uriTemplate);
    }).catch(() => {});
  }
  if (caps.tools) {
    void session.client.listTools().then((r) => {
      cache.tools = r.tools.map((x) => x.name);
    }).catch(() => {});
  }
  if (caps.prompts) {
    void session.client.listPrompts().then((r) => {
      cache.prompts = r.prompts.map((x) => x.name);
    }).catch(() => {});
  }

  const verbs = [
    "discover", "server",
    "resources", "templates", "read",
    "tools", "call",
    "prompts", "prompt",
    "complete",
    "json", "help", "quit", "exit",
  ];

  return (line: string): [string[], string] => {
    const tokens = shellParse(line).filter(
      (t): t is string => typeof t === "string",
    );
    const trailingSpace = /\s$/.test(line);
    const head = tokens[0] as string | undefined;

    // Completing the verb itself.
    if (!head || (tokens.length === 1 && !trailingSpace)) {
      const partial = head ?? "";
      const hits = verbs.filter((v) => v.startsWith(partial));
      return [hits.length ? hits : verbs, partial];
    }

    // Completing the second token.
    const partial = trailingSpace ? "" : (tokens[tokens.length - 1] as string);

    let pool: string[] = [];
    if (head === "read") pool = cache.resources ?? [];
    else if (head === "call") pool = cache.tools ?? [];
    else if (head === "prompt") pool = cache.prompts ?? [];
    else if (head === "complete") {
      // Second token: prompt|resource. Third token: ref.
      if (tokens.length === 1 || (tokens.length === 2 && !trailingSpace)) {
        const choices = ["prompt", "resource"];
        const hits = choices.filter((v) => v.startsWith(partial));
        return [hits.length ? hits : choices, partial];
      }
      const sub = tokens[1];
      if (sub === "prompt") pool = cache.prompts ?? [];
      else if (sub === "resource") pool = cache.resourceTemplates ?? [];

      // For `complete resource <template> <var>`, completer offers the
      // template's variable names as a hint.
      if (
        (tokens[1] === "resource" || tokens[1] === "prompt") &&
        ((tokens.length === 3 && trailingSpace) ||
          (tokens.length === 4 && !trailingSpace))
      ) {
        const template = tokens[2];
        if (template) {
          const varNames =
            tokens[1] === "resource"
              ? extractTemplateVars(template)
              : []; // for prompts the names live server-side
          const hits = varNames.filter((v) => v.startsWith(partial));
          if (hits.length) return [hits, partial];
        }
      }
    }

    const hits = pool.filter((v) => v.startsWith(partial));
    return [hits, partial];
  };
}

function parseJsonObject(s: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (e) {
    throw new Error(`${label} must be valid JSON: ${(e as Error).message}`);
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}
