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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Command, Option } from "commander";
import pc from "picocolors";

import * as actions from "@rolaca11/mcp-inspector-core/actions";
import { connect } from "@rolaca11/mcp-inspector-core/client";
import { appendConfigFiles } from "@rolaca11/mcp-inspector-core/config-files";
import {
  ensureInspectorConfig,
  loadConfigSync,
  type LoadedConfig,
  type ServerConfig,
} from "@rolaca11/mcp-inspector-core/config";
import { configDir } from "@rolaca11/mcp-inspector-core/paths";
import { runRepl } from "./repl.js";
import { errorMessage } from "@rolaca11/mcp-inspector-core/format";
import { parseTarget, setLoadedConfig } from "@rolaca11/mcp-inspector-core/target";
import {
  createTeamCityStream,
  loadSuites,
  renderReport,
  runSuites,
  REPORTERS,
  type ReporterName,
  type RunOptions,
} from "@rolaca11/mcp-inspector-core/testing";
import { VERSION } from "@rolaca11/mcp-inspector-core/version";

interface GlobalOpts {
  json?: boolean;
  quiet?: boolean;
  scope?: string;
  clientName?: string;
  countTokens?: boolean;
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
    )
    .option(
      "--count-tokens",
      "count response tokens via the claude-tokenizer API",
    );
}

/**
 * Wraps an action that needs an open session: parses the target, connects,
 * runs the action, then always closes the session.
 */
function withSession(
  fn: (
    session: Awaited<ReturnType<typeof connect>>,
    args: { format: { json: boolean; countTokens: boolean } },
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
      await fn(session, { format: { json: !!opts.json, countTokens: !!opts.countTokens } });
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
        await actions.readResource(session, uri, { json: !!opts.json, countTokens: !!opts.countTokens });
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
            { json: !!opts.json, countTokens: !!opts.countTokens },
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
          await actions.getPrompt(session, name, stringified, { json: !!opts.json, countTokens: !!opts.countTokens });
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
          { json: !!opts.json, countTokens: !!opts.countTokens },
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
      await actions.authLogout(spec, { json: !!opts.json, countTokens: !!opts.countTokens });
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
      await actions.authStatus(spec, { json: !!opts.json, countTokens: !!opts.countTokens });
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
      sources: config.sources.map((s) => ({ path: s.path, label: s.label })),
      errors: config.errors,
      servers: Object.fromEntries(
        Array.from(config.servers.values()).map(({ id, name, config: c, source, label }) => [
          id,
          { ...c, _name: name, _source: source, _label: label },
        ]),
      ),
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (config.sources.length === 0) {
    console.log(pc.dim("No config files found."));
    if (config.errors.length === 0) return;
  }
  if (config.sources.length > 0) {
    console.log(pc.bold("Loaded files:"));
    for (const s of config.sources) {
      const count = Object.keys(s.servers).length;
      console.log(`  ${s.path} ${pc.dim(`(${s.label}, ${count} server${count === 1 ? "" : "s"})`)}`);
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

  const entries = Array.from(config.servers.values());
  if (entries.length === 0) {
    console.log(pc.dim("No named servers."));
    return;
  }

  console.log(pc.bold(`Named servers (${entries.length}):`));
  // Compute padding for the name column.
  const nameWidth = Math.max(...entries.map((e) => e.id.length), 4);
  for (const { id, name, config: cfg, source, label } of entries) {
    const padded = id.padEnd(nameWidth);
    if ("url" in cfg) {
      const kind = cfg.type ?? "http";
      console.log(`  ${pc.cyan(padded)}  ${cfg.url}  ${pc.dim(`[${kind}]`)}`);
    } else {
      const argsStr = (cfg.args ?? []).join(" ");
      console.log(
        `  ${pc.cyan(padded)}  ${cfg.command}${argsStr ? " " + argsStr : ""}  ${pc.dim("[stdio]")}`,
      );
    }
    const namePart = id === name ? "" : `name ${name}, `;
    console.log(`  ${" ".repeat(nameWidth)}  ${pc.dim(`${namePart}from ${source} (${label})`)}`);
  }
}

/* ------------------------------------------------------------------ */
/* config                                                              */
/* ------------------------------------------------------------------ */

const inspectorConfigFile = path.join(configDir(), "mcp.json");

function readInspectorConfig(): Record<string, unknown> {
  if (!existsSync(inspectorConfigFile)) return {};
  const raw = readFileSync(inspectorConfigFile, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${inspectorConfigFile}: expected a JSON object at top level`);
  }
  return parsed as Record<string, unknown>;
}

function writeInspectorConfig(obj: Record<string, unknown>): void {
  mkdirSync(path.dirname(inspectorConfigFile), { recursive: true });
  writeFileSync(inspectorConfigFile, JSON.stringify(obj, null, 2) + "\n");
}

function getServersRecord(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const s = obj.mcpServers;
  if (s === undefined) return {};
  if (typeof s !== "object" || s === null || Array.isArray(s)) {
    throw new Error(`${inspectorConfigFile}: "mcpServers" must be an object`);
  }
  return s as Record<string, unknown>;
}

const config = program
  .command("config")
  .description(
    `Manage the inspector-level MCP server config (${inspectorConfigFile})`,
  );

config
  .command("path")
  .description("Print the inspector config file path")
  .action(() => {
    console.log(inspectorConfigFile);
  });

config
  .command("list")
  .description("List servers defined in the inspector config")
  .option("--json", "emit machine-readable JSON")
  .action((_opts, cmd: Command) => {
    const opts = cmd.opts() as { json?: boolean };
    const obj = readInspectorConfig();
    const servers = getServersRecord(obj);
    const entries = Object.entries(servers);

    if (opts.json) {
      console.log(JSON.stringify({ path: inspectorConfigFile, servers }, null, 2));
      return;
    }

    console.log(pc.dim(inspectorConfigFile));
    if (entries.length === 0) {
      console.log(pc.dim("No servers configured."));
      return;
    }

    const nameWidth = Math.max(...entries.map(([n]) => n.length), 4);
    for (const [name, value] of entries) {
      const v = value as Record<string, unknown>;
      const padded = name.padEnd(nameWidth);
      if (typeof v.url === "string") {
        const kind = (typeof v.type === "string" && v.type) || "http";
        console.log(`  ${pc.cyan(padded)}  ${v.url}  ${pc.dim(`[${kind}]`)}`);
      } else if (typeof v.command === "string") {
        const argsStr = Array.isArray(v.args) ? (v.args as string[]).join(" ") : "";
        console.log(
          `  ${pc.cyan(padded)}  ${v.command}${argsStr ? " " + argsStr : ""}  ${pc.dim("[stdio]")}`,
        );
      } else {
        console.log(`  ${pc.cyan(padded)}  ${pc.dim("(unrecognized entry)")}`);
      }
    }
  });

config
  .command("add")
  .argument("<name>", "server name")
  .option("--command <cmd>", "stdio command to run")
  .option("--args <json>", "stdio args as a JSON array", "[]")
  .option("--env <json>", "stdio env as a JSON object", "{}")
  .option("--cwd <path>", "stdio working directory")
  .option("--url <url>", "HTTP server URL")
  .option(
    "--type <type>",
    "transport type (http, sse, streamable-http, stdio)",
  )
  .option("--headers <json>", "HTTP headers as a JSON object", "{}")
  .option("-f, --force", "overwrite if the server name already exists")
  .description("Add a server to the inspector config")
  .action((name: string, _opts, cmd: Command) => {
    const opts = cmd.opts() as {
      command?: string;
      args?: string;
      env?: string;
      cwd?: string;
      url?: string;
      type?: string;
      headers?: string;
      force?: boolean;
    };

    if (!opts.command && !opts.url) {
      throw new Error("either --command or --url is required");
    }
    if (opts.command && opts.url) {
      throw new Error("--command and --url are mutually exclusive");
    }

    let entry: ServerConfig;
    if (opts.command) {
      entry = { command: opts.command };
      const args = JSON.parse(opts.args ?? "[]");
      if (!Array.isArray(args)) throw new Error("--args must be a JSON array");
      if (args.length > 0) entry.args = args as string[];
      const env = JSON.parse(opts.env ?? "{}");
      if (typeof env !== "object" || env === null || Array.isArray(env))
        throw new Error("--env must be a JSON object");
      if (Object.keys(env).length > 0) entry.env = env as Record<string, string>;
      if (opts.cwd) entry.cwd = opts.cwd;
      if (opts.type === "stdio") entry.type = "stdio";
    } else {
      entry = { url: opts.url! };
      const headers = JSON.parse(opts.headers ?? "{}");
      if (typeof headers !== "object" || headers === null || Array.isArray(headers))
        throw new Error("--headers must be a JSON object");
      if (Object.keys(headers).length > 0)
        (entry as { headers?: Record<string, string> }).headers =
          headers as Record<string, string>;
      if (
        opts.type === "http" ||
        opts.type === "sse" ||
        opts.type === "streamable-http"
      ) {
        (entry as { type?: string }).type = opts.type;
      }
    }

    const obj = readInspectorConfig();
    const servers = getServersRecord(obj);
    if (name in servers && !opts.force) {
      throw new Error(
        `server "${name}" already exists — use --force to overwrite`,
      );
    }
    servers[name] = entry;
    obj.mcpServers = servers;
    writeInspectorConfig(obj);
    console.log(
      pc.green(`Added "${name}" to ${inspectorConfigFile}`),
    );
  });

config
  .command("remove")
  .argument("<name>", "server name to remove")
  .description("Remove a server from the inspector config")
  .action((name: string) => {
    const obj = readInspectorConfig();
    const servers = getServersRecord(obj);
    if (!(name in servers)) {
      throw new Error(
        `server "${name}" not found in ${inspectorConfigFile}`,
      );
    }
    delete servers[name];
    obj.mcpServers = servers;
    writeInspectorConfig(obj);
    console.log(
      pc.green(`Removed "${name}" from ${inspectorConfigFile}`),
    );
  });

/* ------------------------------------------------------------------ */
/* test                                                                */
/* ------------------------------------------------------------------ */

attachGlobal(
  program
    .command("test")
    .argument(
      "[paths...]",
      "test files or directories to run (default: ./mcp-tests)",
    )
    .option(
      "--target <target>",
      "default target for suites/cases that don't declare one",
    )
    .addOption(
      new Option("--reporter <name>", "output format").choices([...REPORTERS]),
    )
    .option("--out <file>", "write the report to a file instead of stdout")
    .option("--bail", "stop after the first failing case")
    .option("--filter <substr>", "only run cases whose name includes <substr>")
    .option(
      "--var <pair>",
      "set a variable as key=value (repeatable)",
      (v: string, prev: string[]) => [...prev, v],
      [] as string[],
    )
    .description(
      "Run declarative YAML/JSON test suites against MCP servers",
    )
    .action(async (paths: string[], _opts, cmd: Command) => {
      const opts = collectOpts(cmd) as GlobalOpts & {
        target?: string;
        reporter?: ReporterName;
        out?: string;
        bail?: boolean;
        filter?: string;
        var?: string[];
      };

      const inputPaths = paths.length > 0 ? paths : ["mcp-tests"];
      // --json is shorthand for the json reporter.
      const reporter: ReporterName = opts.json ? "json" : opts.reporter ?? "console";
      const vars = parseVarPairs(opts.var ?? []);

      const suites = await loadSuites(inputPaths);
      if (suites.length === 0) {
        console.error(
          pc.yellow(
            `No test files (.yaml/.yml/.json) found in: ${inputPaths.join(", ")}`,
          ),
        );
        process.exitCode = 1;
        return;
      }

      const runOptions: RunOptions = {
        ...(opts.target ? { defaultTarget: opts.target } : {}),
        vars,
        ...(opts.bail ? { bail: true } : {}),
        ...(opts.filter ? { filter: opts.filter } : {}),
        connectOptions: {
          ...(opts.scope ? { scope: opts.scope } : {}),
          ...(opts.clientName ? { clientName: opts.clientName } : {}),
          ...(opts.quiet ? { quiet: true } : {}),
        },
      };

      // For the teamcity reporter on stdout, stream service messages live as
      // each case resolves, so JetBrains / TeamCity build the test tree in
      // real time. With --out we fall through to the batch render below.
      const liveTeamCity =
        reporter === "teamcity" && !opts.out
          ? createTeamCityStream((line) => process.stdout.write(line + "\n"))
          : null;
      if (liveTeamCity) {
        runOptions.onCaseStart = liveTeamCity.onCaseStart;
        runOptions.onCaseComplete = liveTeamCity.onCaseComplete;
      }

      const report = await runSuites(suites, runOptions);

      if (liveTeamCity) {
        liveTeamCity.end();
      } else {
        const color =
          reporter === "console" && !opts.out && process.stdout.isTTY === true;
        const output = renderReport(reporter, report, { color });
        if (opts.out) {
          writeFileSync(opts.out, output + "\n");
          if (!opts.quiet) console.error(pc.dim(`report written to ${opts.out}`));
        } else {
          console.log(output);
        }
      }

      if (!report.ok) process.exitCode = 1;
    }),
);

/* ------------------------------------------------------------------ */
/* serve                                                               */
/* ------------------------------------------------------------------ */

program
  .command("serve")
  .description(
    "Start the web dashboard. Hosts the bundled UI at / and the tRPC API at /api/trpc.",
  )
  .option("-p, --port <port>", "port to bind", "8765")
  .option("--host <host>", "interface to bind", "127.0.0.1")
  .option(
    "-c, --config <paths...>",
    "path(s) to .mcp.json files (repeatable; loaded after defaults)",
    appendConfigFiles,
    [] as string[],
  )
  .option("--no-open", "don't open the dashboard in the default browser")
  .option("--no-ui", "expose the API only — skip serving the static UI")
  .option("-q, --quiet", "suppress informational logs")
  .action(async (_opts, cmd: Command) => {
    const opts = cmd.opts() as {
      port: string;
      host: string;
      config: string[];
      open: boolean;
      ui: boolean;
      quiet?: boolean;
    };
    const port = Number(opts.port);
    if (!Number.isFinite(port) || port < 0 || port > 65_535) {
      throw new Error(`invalid port: ${opts.port}`);
    }
    const configFiles = opts.config.map((p) => path.resolve(p));
    const configFile = configFiles.length > 0 ? configFiles : undefined;
    const { startServer } = await import("./server.js");
    const server = await startServer({
      port,
      host: opts.host,
      noUi: !opts.ui,
      ...(opts.quiet ? { quiet: true } : {}),
      ...(configFile ? { configFile } : {}),
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
  ensureInspectorConfig();
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
    else console.error(pc.red(`error: ${errorMessage(err)}`));
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

function parseVarPairs(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const eq = p.indexOf("=");
    if (eq === -1) throw new Error(`--var must be key=value, got: ${p}`);
    out[p.slice(0, eq)] = p.slice(eq + 1);
  }
  return out;
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
