#!/usr/bin/env node
/**
 * CLI entry point. Wires up commander subcommands that all share the same
 * "open a session, run an action, close the session" pattern.
 *
 * Every subcommand accepts a target as its first positional argument:
 *
 *   mcp-inspector <verb> <subverb...> <target> [args...]
 *
 * where <target> is one of:
 *   - a named server defined in `.mcp.json` (cwd or home),
 *   - an HTTP URL (e.g. https://example.com/mcp), or
 *   - a quoted stdio command (e.g. "npx -y @modelcontextprotocol/server-everything").
 */

import { Command, Option } from "commander";
import pc from "picocolors";

import * as actions from "./actions.js";
import { connect } from "./client.js";
import { loadConfigSync, type LoadedConfig } from "./config.js";
import { runRepl } from "./repl.js";
import { parseTarget, setLoadedConfig } from "./target.js";

const VERSION = "0.1.0";

interface GlobalOpts {
  json?: boolean;
  quiet?: boolean;
  scope?: string;
  clientName?: string;
}

function attachGlobal(cmd: Command): Command {
  return cmd
    .option("--json", "emit machine-readable JSON instead of formatted output")
    .option("-q, --quiet", "suppress informational logs (e.g. OAuth flow)")
    .option(
      "--scope <scope>",
      "OAuth scope to request (HTTP servers only)",
    )
    .option(
      "--client-name <name>",
      "OAuth client name advertised during dynamic client registration",
    );
}

/**
 * Wraps an action that needs an open session: parses the target, connects,
 * runs the action, then always closes the session.
 */
function withSession(
  fn: (
    session: Awaited<ReturnType<typeof connect>>,
    args: { format: { json: boolean } },
  ) => Promise<void>,
) {
  return async (target: string, ..._rest: unknown[]) => {
    const cmd = _rest[_rest.length - 1] as Command;
    const opts = collectOpts(cmd);
    const spec = parseTarget(target);
    const session = await connect(spec, {
      ...(opts.scope ? { scope: opts.scope } : {}),
      ...(opts.clientName ? { clientName: opts.clientName } : {}),
      ...(opts.quiet ? { quiet: true } : {}),
    });
    try {
      await fn(session, { format: { json: !!opts.json } });
    } finally {
      await session.close();
    }
  };
}

function collectOpts(cmd: Command): GlobalOpts {
  // Options can be defined on either the leaf or on a parent (we attach them
  // to leaves here, but commander still walks up). Merge leaf-first.
  const merged: GlobalOpts = {};
  let cur: Command | null = cmd;
  while (cur) {
    Object.assign(merged, cur.opts());
    cur = cur.parent;
  }
  return merged;
}

const program = new Command()
  .name("mcp-inspector")
  .description(
    "CLI MCP client. Connect to stdio or HTTP MCP servers, run OAuth, " +
      "discover resources/tools/prompts/templates, call them, and request completions.",
  )
  .version(VERSION);

/* ------------------------------------------------------------------ */
/* connect                                                             */
/* ------------------------------------------------------------------ */

attachGlobal(
  program
    .command("connect")
    .argument("<target>", "named server, MCP server URL, or quoted stdio command")
    .description("Open an interactive REPL against a server")
    .action(async (target: string, _opts, cmd: Command) => {
      const opts = collectOpts(cmd);
      const spec = parseTarget(target);
      const session = await connect(spec, {
        ...(opts.scope ? { scope: opts.scope } : {}),
        ...(opts.clientName ? { clientName: opts.clientName } : {}),
        ...(opts.quiet ? { quiet: true } : {}),
      });
      try {
        await runRepl(session);
      } finally {
        await session.close();
      }
    }),
);

/* ------------------------------------------------------------------ */
/* discover                                                            */
/* ------------------------------------------------------------------ */

attachGlobal(
  program
    .command("discover")
    .argument("<target>", "named server, MCP server URL, or quoted stdio command")
    .description("List server info, capabilities, resources, templates, tools, and prompts")
    .action(
      withSession(async (session, { format }) => {
        await actions.discover(session, format);
      }),
    ),
);

/* ------------------------------------------------------------------ */
/* resources                                                           */
/* ------------------------------------------------------------------ */

const resources = program
  .command("resources")
  .description("Resource and resource-template operations");

attachGlobal(
  resources
    .command("list")
    .argument("<target>", "named server, MCP server URL, or quoted stdio command")
    .description("List resources")
    .action(
      withSession(async (session, { format }) => {
        await actions.listResources(session, format);
      }),
    ),
);

attachGlobal(
  resources
    .command("templates")
    .argument("<target>", "named server, MCP server URL, or quoted stdio command")
    .description("List resource templates")
    .action(
      withSession(async (session, { format }) => {
        await actions.listResourceTemplates(session, format);
      }),
    ),
);

attachGlobal(
  resources
    .command("read")
    .argument("<target>", "named server, MCP server URL, or quoted stdio command")
    .argument("<uri>", "resource URI to read")
    .description("Read a resource")
    .action(async (target: string, uri: string, _opts, cmd: Command) => {
      const opts = collectOpts(cmd);
      const spec = parseTarget(target);
      const session = await connect(spec, {
        ...(opts.scope ? { scope: opts.scope } : {}),
        ...(opts.clientName ? { clientName: opts.clientName } : {}),
        ...(opts.quiet ? { quiet: true } : {}),
      });
      try {
        await actions.readResource(session, uri, { json: !!opts.json });
      } finally {
        await session.close();
      }
    }),
);

/* ------------------------------------------------------------------ */
/* tools                                                               */
/* ------------------------------------------------------------------ */

const tools = program
  .command("tools")
  .description("Tool operations");

attachGlobal(
  tools
    .command("list")
    .argument("<target>", "named server, MCP server URL, or quoted stdio command")
    .description("List tools")
    .action(
      withSession(async (session, { format }) => {
        await actions.listTools(session, format);
      }),
    ),
);

attachGlobal(
  tools
    .command("call")
    .argument("<target>", "named server, MCP server URL, or quoted stdio command")
    .argument("<name>", "tool name")
    .option("--args <json>", "tool arguments as a JSON object", "{}")
    .description("Call a tool. Pass arguments as a JSON object via --args.")
    .action(
      async (
        target: string,
        name: string,
        _opts,
        cmd: Command,
      ) => {
        const opts = collectOpts(cmd) as GlobalOpts & { args?: string };
        const spec = parseTarget(target);
        const args = parseJsonObject(opts.args ?? "{}", "--args");
        const session = await connect(spec, {
          ...(opts.scope ? { scope: opts.scope } : {}),
          ...(opts.clientName ? { clientName: opts.clientName } : {}),
          ...(opts.quiet ? { quiet: true } : {}),
        });
        try {
          await actions.callTool(
            session,
            { name, arguments: args },
            { json: !!opts.json },
          );
        } finally {
          await session.close();
        }
      },
    ),
);

/* ------------------------------------------------------------------ */
/* prompts                                                             */
/* ------------------------------------------------------------------ */

const prompts = program
  .command("prompts")
  .description("Prompt operations");

attachGlobal(
  prompts
    .command("list")
    .argument("<target>", "named server, MCP server URL, or quoted stdio command")
    .description("List prompts")
    .action(
      withSession(async (session, { format }) => {
        await actions.listPrompts(session, format);
      }),
    ),
);

attachGlobal(
  prompts
    .command("get")
    .argument("<target>", "named server, MCP server URL, or quoted stdio command")
    .argument("<name>", "prompt name")
    .option("--args <json>", "prompt arguments as a JSON object of strings", "{}")
    .description("Get a prompt template (with arguments substituted)")
    .action(
      async (target: string, name: string, _opts, cmd: Command) => {
        const opts = collectOpts(cmd) as GlobalOpts & { args?: string };
        const spec = parseTarget(target);
        const parsed = parseJsonObject(opts.args ?? "{}", "--args");
        const stringified: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          stringified[k] = typeof v === "string" ? v : JSON.stringify(v);
        }
        const session = await connect(spec, {
          ...(opts.scope ? { scope: opts.scope } : {}),
          ...(opts.clientName ? { clientName: opts.clientName } : {}),
          ...(opts.quiet ? { quiet: true } : {}),
        });
        try {
          await actions.getPrompt(session, name, stringified, { json: !!opts.json });
        } finally {
          await session.close();
        }
      },
    ),
);

/* ------------------------------------------------------------------ */
/* complete                                                            */
/* ------------------------------------------------------------------ */

attachGlobal(
  program
    .command("complete")
    .argument("<target>", "named server, MCP server URL, or quoted stdio command")
    .addOption(
      new Option("--ref-type <type>", "kind of reference to complete")
        .choices(["prompt", "resource"])
        .makeOptionMandatory(true),
    )
    .requiredOption(
      "--ref <ref>",
      "prompt name (when --ref-type=prompt) or URI template (when --ref-type=resource)",
    )
    .requiredOption("--arg <name>", "argument or template-variable name to complete")
    .option("--value <partial>", "partial value typed so far", "")
    .option(
      "--context <json>",
      "JSON object of already-known sibling argument values (for cascading completions)",
    )
    .description(
      "Request completion suggestions for a prompt argument or a resource-template variable",
    )
    .action(async (target: string, _opts, cmd: Command) => {
      const opts = collectOpts(cmd) as GlobalOpts & {
        refType: "prompt" | "resource";
        ref: string;
        arg: string;
        value?: string;
        context?: string;
      };
      const spec = parseTarget(target);
      const context = opts.context
        ? parseStringMap(opts.context, "--context")
        : undefined;
      const session = await connect(spec, {
        ...(opts.scope ? { scope: opts.scope } : {}),
        ...(opts.clientName ? { clientName: opts.clientName } : {}),
        ...(opts.quiet ? { quiet: true } : {}),
      });
      try {
        await actions.complete(
          session,
          {
            refType: opts.refType,
            ref: opts.ref,
            argument: opts.arg,
            value: opts.value ?? "",
            ...(context ? { context } : {}),
          },
          { json: !!opts.json },
        );
      } finally {
        await session.close();
      }
    }),
);

/* ------------------------------------------------------------------ */
/* auth                                                                */
/* ------------------------------------------------------------------ */

const auth = program.command("auth").description("OAuth credential management for HTTP servers");

attachGlobal(
  auth
    .command("login")
    .argument("<target>", "named HTTP server, or MCP server URL")
    .description(
      "Run the OAuth flow now (otherwise the first call to any other command does it lazily)",
    )
    .action(async (target: string, _opts, cmd: Command) => {
      const opts = collectOpts(cmd);
      const spec = parseTarget(target);
      if (spec.kind !== "http") {
        throw new Error("auth login only applies to HTTP targets");
      }
      const session = await connect(spec, {
        ...(opts.scope ? { scope: opts.scope } : {}),
        ...(opts.clientName ? { clientName: opts.clientName } : {}),
        ...(opts.quiet ? { quiet: true } : {}),
      });
      try {
        if (opts.json) {
          await actions.authStatus(spec, { json: true });
        } else {
          console.log(pc.green(`Logged in to ${spec.raw}`));
        }
      } finally {
        await session.close();
      }
    }),
);

attachGlobal(
  auth
    .command("logout")
    .argument("<target>", "named server, MCP server URL, or quoted stdio command")
    .description("Forget stored OAuth tokens & registered client info for this target")
    .action(async (target: string, _opts, cmd: Command) => {
      const opts = collectOpts(cmd);
      const spec = parseTarget(target);
      await actions.authLogout(spec, { json: !!opts.json });
    }),
);

attachGlobal(
  auth
    .command("status")
    .argument("<target>", "named server, MCP server URL, or quoted stdio command")
    .description("Show whether OAuth credentials are stored for a target")
    .action(async (target: string, _opts, cmd: Command) => {
      const opts = collectOpts(cmd);
      const spec = parseTarget(target);
      await actions.authStatus(spec, { json: !!opts.json });
    }),
);

/* ------------------------------------------------------------------ */
/* servers                                                             */
/* ------------------------------------------------------------------ */

program
  .command("servers")
  .description(
    "List named servers loaded from .mcp.json files in cwd and home directory",
  )
  .option("--json", "emit machine-readable JSON")
  .action((_opts, cmd: Command) => {
    const opts = cmd.opts() as { json?: boolean };
    const config = loadConfigSync();
    printServers(config, !!opts.json);
  });

function printServers(config: LoadedConfig, asJson: boolean) {
  if (asJson) {
    const out = {
      sources: config.sources.map((s) => s.path),
      errors: config.errors,
      servers: Object.fromEntries(
        Array.from(config.servers.entries()).map(([name, { config: c, source }]) => [
          name,
          { ...c, _source: source },
        ]),
      ),
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (config.sources.length === 0) {
    console.log(pc.dim("No .mcp.json files found in cwd or home directory."));
    if (config.errors.length === 0) return;
  }
  if (config.sources.length > 0) {
    console.log(pc.bold("Loaded files (in precedence order, last wins):"));
    for (const s of config.sources) {
      const count = Object.keys(s.servers).length;
      console.log(`  ${s.path} ${pc.dim(`(${count} server${count === 1 ? "" : "s"})`)}`);
    }
    console.log();
  }

  if (config.errors.length > 0) {
    console.log(pc.bold(pc.yellow("Errors:")));
    for (const e of config.errors) {
      console.log(`  ${pc.yellow(e.path)}: ${e.message}`);
    }
    console.log();
  }

  const entries = Array.from(config.servers.entries());
  if (entries.length === 0) {
    console.log(pc.dim("No named servers."));
    return;
  }

  console.log(pc.bold(`Named servers (${entries.length}):`));
  // Compute padding for the name column.
  const nameWidth = Math.max(...entries.map(([n]) => n.length), 4);
  for (const [name, { config: cfg, source }] of entries) {
    const padded = name.padEnd(nameWidth);
    if ("url" in cfg) {
      const kind = cfg.type ?? "http";
      console.log(`  ${pc.cyan(padded)}  ${cfg.url}  ${pc.dim(`[${kind}]`)}`);
    } else {
      const argsStr = (cfg.args ?? []).join(" ");
      console.log(
        `  ${pc.cyan(padded)}  ${cfg.command}${argsStr ? " " + argsStr : ""}  ${pc.dim("[stdio]")}`,
      );
    }
    console.log(`  ${" ".repeat(nameWidth)}  ${pc.dim(`from ${source}`)}`);
  }
}

/* ------------------------------------------------------------------ */
/* serve                                                               */
/* ------------------------------------------------------------------ */

program
  .command("serve")
  .description(
    "Start the web dashboard. Hosts the bundled UI at /, the JSON API at /api/*.",
  )
  .option("-p, --port <port>", "port to bind", "8765")
  .option("--host <host>", "interface to bind", "127.0.0.1")
  .option("--no-open", "don't open the dashboard in the default browser")
  .option("--no-ui", "expose the API only — skip serving the static UI")
  .option("-q, --quiet", "suppress informational logs")
  .action(async (_opts, cmd: Command) => {
    const opts = cmd.opts() as {
      port: string;
      host: string;
      open: boolean;
      ui: boolean;
      quiet?: boolean;
    };
    const port = Number(opts.port);
    if (!Number.isFinite(port) || port < 0 || port > 65_535) {
      throw new Error(`invalid port: ${opts.port}`);
    }
    const { startServer } = await import("./server.js");
    const server = await startServer({
      port,
      host: opts.host,
      noUi: !opts.ui,
      ...(opts.quiet ? { quiet: true } : {}),
    });

    if (opts.open && opts.ui) {
      const { default: openBrowser } = await import("open");
      await openBrowser(server.url).catch(() => {
        /* not fatal — link is already in stderr */
      });
    }
  });

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  // Load `.mcp.json` from cwd + home and make it available to parseTarget.
  // Errors here don't abort the run — they're surfaced by `mcp-inspector servers`.
  const config = loadConfigSync();
  setLoadedConfig(config);
  if (config.errors.length > 0 && !process.env.MCPI_QUIET_CONFIG) {
    for (const e of config.errors) {
      console.error(
        pc.yellow(`warning: ${e.path}: ${e.message}`),
      );
    }
  }

  try {
    await program.parseAsync(process.argv);
  } catch (e) {
    const err = e as Error & { code?: unknown };
    if (process.env.MCPI_DEBUG) console.error(err.stack ?? err);
    else console.error(pc.red(`error: ${err.message}`));
    process.exitCode = 1;
  }
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

function parseStringMap(s: string, label: string): Record<string, string> {
  const o = parseJsonObject(s, label);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

await main();
