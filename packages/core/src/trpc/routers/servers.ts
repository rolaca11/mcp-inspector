import { promises as fs } from "node:fs";

import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

import { loadConfigSync, type LoadedConfig } from "../../config.js";
import { parseTarget, setLoadedConfig, targetId } from "../../target.js";
import { authFile } from "../../paths.js";
import type { Session } from "../../client.js";
import {
  type ActivityEntry,
  errorActivity,
  runActivity,
  runActivityWithWarnings,
} from "../activity.js";
import {
  callToolInput,
  completeInput,
  getPromptInput,
  readResourceInput,
  serverNameInput,
} from "../schemas.js";
import {
  publicProcedure,
  router,
  serverProcedure,
  sessionProcedure,
  type SessionContext,
  type ServerContext,
  type SessionPool,
} from "../trpc.js";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isENOENT(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "ENOENT"
  );
}

function summarizeServers(config: LoadedConfig) {
  return {
    sources: config.sources.map((s) => ({
      path: s.path,
      label: s.label,
      serverCount: Object.keys(s.servers).length,
    })),
    errors: config.errors,
    servers: Array.from(config.servers.values()).map(
      ({ id, name, config: cfg, source, label }) => {
        const isHttp = "url" in cfg;
        return {
          id,
          name,
          source,
          sourceLabel: label,
          transport: (cfg.type ?? (isHttp ? "http" : "stdio")) as
            | "stdio"
            | "http"
            | "sse"
            | "streamable-http",
          target: isHttp
            ? cfg.url
            : `${cfg.command} ${(cfg.args ?? []).join(" ")}`.trim(),
          ...(isHttp
            ? { headers: cfg.headers }
            : { args: cfg.args, env: cfg.env, cwd: cfg.cwd }),
        };
      },
    ),
  };
}

async function readAuthStatus(name: string) {
  const spec = parseTarget(name);
  const id = targetId(spec);
  const file = authFile(id);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as {
      tokens?: {
        token_type?: string;
        refresh_token?: string;
        scope?: string;
      };
      clientInformation?: unknown;
    };
    return {
      file,
      exists: true,
      hasTokens: !!parsed.tokens,
      hasRefreshToken: !!parsed.tokens?.refresh_token,
      hasClientInfo: !!parsed.clientInformation,
      tokenType: parsed.tokens?.token_type,
      scope: parsed.tokens?.scope,
    };
  } catch (e) {
    if (isENOENT(e)) return { file, exists: false };
    throw e;
  }
}

async function deleteAuthFile(name: string) {
  const spec = parseTarget(name);
  const id = targetId(spec);
  const file = authFile(id);
  try {
    await fs.unlink(file);
    return { removed: true, file };
  } catch (e) {
    if (isENOENT(e)) return { removed: false, file };
    throw e;
  }
}

type ToolOutputValidator = (value: unknown) => {
  valid: boolean;
  errorMessage?: string;
};

interface RawToolClient {
  request(
    request: { method: "tools/call"; params: { name: string; arguments: Record<string, unknown> } },
    resultSchema: typeof CallToolResultSchema,
  ): Promise<unknown>;
  listTools(): Promise<{ tools?: Array<{ name: string; outputSchema?: unknown }> }>;
  getToolOutputValidator?(toolName: string): ToolOutputValidator | undefined;
  isToolTaskRequired?(toolName: string): boolean;
}

function validationWarning(message: string): string {
  return `Structured content does not match the tool's output schema: ${message}`;
}

async function callToolAllowingStructuredContentWarnings(
  session: Session,
  toolName: string,
  toolArgs: Record<string, unknown>,
) {
  const client = session.client as unknown as RawToolClient;
  if (client.isToolTaskRequired?.(toolName)) {
    throw new Error(
      `Tool "${toolName}" requires task-based execution. Use client.experimental.tasks.callToolStream() instead.`,
    );
  }

  let hasOutputSchema = false;
  let validator = client.getToolOutputValidator?.(toolName);
  if (!validator) {
    const tools = (await client.listTools())?.tools ?? [];
    hasOutputSchema = tools.some((tool) => tool.name === toolName && !!tool.outputSchema);
    validator = client.getToolOutputValidator?.(toolName);
  } else {
    hasOutputSchema = true;
  }

  const result = await client.request(
    { method: "tools/call", params: { name: toolName, arguments: toolArgs } },
    CallToolResultSchema,
  );

  const resultObj =
    typeof result === "object" && result !== null
      ? (result as { structuredContent?: unknown; isError?: boolean })
      : {};
  const warnings: string[] = [];
  if (hasOutputSchema && !resultObj.structuredContent && !resultObj.isError) {
    warnings.push("Tool has an output schema but did not return structured content");
  } else if (validator && resultObj.structuredContent) {
    try {
      const validationResult = validator(resultObj.structuredContent);
      if (!validationResult.valid) {
        warnings.push(validationWarning(validationResult.errorMessage ?? "unknown validation error"));
      }
    } catch (e) {
      warnings.push(
        `Failed to validate structured content: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { result, warnings: warnings.length > 0 ? warnings : undefined };
}

async function actionDiscoverActivities(
  name: string,
  sessions: SessionPool,
): Promise<ActivityEntry[]> {
  const initActivity = await runActivity(
    "discover",
    "initialize",
    async () => {
      const session = await sessions.acquire(name);
      const caps = session.client.getServerCapabilities() ?? {};
      const version = session.client.getServerVersion() ?? null;
      const instructions = session.client.getInstructions();
      return { server: { ...version, instructions }, capabilities: caps };
    },
  );

  if (initActivity.outcome === "error") {
    return [initActivity];
  }

  const session = await sessions.acquire(name);
  const caps = session.client.getServerCapabilities() ?? {};

  const listActivities = await Promise.all([
    caps.tools
      ? runActivity("discover", "tools", async () =>
          (await session.client.listTools())?.tools ?? [],
        )
      : null,
    caps.resources
      ? runActivity("discover", "resources", async () =>
          (await session.client.listResources())?.resources ?? [],
        )
      : null,
    caps.resources
      ? runActivity("discover", "templates", async () =>
          (await session.client.listResourceTemplates())?.resourceTemplates ??
          [],
        )
      : null,
    caps.prompts
      ? runActivity("discover", "prompts", async () =>
          (await session.client.listPrompts())?.prompts ?? [],
        )
      : null,
  ]);

  return [
    initActivity,
    ...listActivities.filter((a): a is ActivityEntry => a !== null),
  ];
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

export const serversRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    const config = loadConfigSync(ctx.configOpts);
    setLoadedConfig(config);
    return summarizeServers(config);
  }),

  discover: serverProcedure
    .input(serverNameInput)
    .mutation(async ({ ctx }) => {
      const { serverName, sessions } = ctx as ServerContext;
      await sessions.release(serverName, true);
      const activities = await actionDiscoverActivities(serverName, sessions);
      return { activities };
    }),

  listResources: sessionProcedure
    .input(serverNameInput)
    .query(async ({ ctx }) => {
      const { session } = ctx as SessionContext;
      return session.client.listResources();
    }),

  listResourceTemplates: sessionProcedure
    .input(serverNameInput)
    .query(async ({ ctx }) => {
      const { session } = ctx as SessionContext;
      return session.client.listResourceTemplates();
    }),

  readResource: sessionProcedure
    .input(readResourceInput)
    .mutation(async ({ ctx, input }) => {
      const { session } = ctx as SessionContext;
      const items = Array.isArray(input.items) ? input.items : [input.items];
      const activities = await Promise.all(
        items.map(async (item) => {
          const { uri } = item;
          if (typeof uri !== "string")
            return errorActivity("resource-read", "", "missing `uri`");
          return runActivity("resource-read", uri, () =>
            session.client.readResource({ uri }),
          );
        }),
      );
      return { activities };
    }),

  listTools: sessionProcedure.input(serverNameInput).query(async ({ ctx }) => {
    const { session } = ctx as SessionContext;
    return session.client.listTools();
  }),

  callTool: sessionProcedure
    .input(callToolInput)
    .mutation(async ({ ctx, input }) => {
      const { session } = ctx as SessionContext;
      const items = Array.isArray(input.items) ? input.items : [input.items];
      const activities = await Promise.all(
        items.map(async (item) => {
          const { name: toolName, arguments: toolArgs } = item;
          if (typeof toolName !== "string")
            return errorActivity("tool-call", "", "missing `name`");
          return runActivityWithWarnings("tool-call", toolName, () =>
            callToolAllowingStructuredContentWarnings(
              session,
              toolName,
              toolArgs ?? {},
            ),
          );
        }),
      );
      return { activities };
    }),

  listPrompts: sessionProcedure
    .input(serverNameInput)
    .query(async ({ ctx }) => {
      const { session } = ctx as SessionContext;
      return session.client.listPrompts();
    }),

  getPrompt: sessionProcedure
    .input(getPromptInput)
    .mutation(async ({ ctx, input }) => {
      const { session } = ctx as SessionContext;
      const items = Array.isArray(input.items) ? input.items : [input.items];
      const activities = await Promise.all(
        items.map(async (item) => {
          const { name: promptName, arguments: promptArgs } = item;
          if (typeof promptName !== "string")
            return errorActivity("prompt-get", "", "missing `name`");
          return runActivity("prompt-get", promptName, () =>
            session.client.getPrompt({
              name: promptName,
              arguments: promptArgs ?? {},
            }),
          );
        }),
      );
      return { activities };
    }),

  complete: sessionProcedure
    .input(completeInput)
    .mutation(async ({ ctx, input }) => {
      const { session } = ctx as SessionContext;
      const items = Array.isArray(input.items) ? input.items : [input.items];
      const activities = await Promise.all(
        items.map(async (item) => {
          const { refType, ref, argument, value, context } = item;
          return runActivity(
            "complete",
            `${refType}:${ref}/${argument}`,
            () => {
              const refObj =
                refType === "prompt"
                  ? ({ type: "ref/prompt" as const, name: ref })
                  : ({ type: "ref/resource" as const, uri: ref });
              const params: Parameters<Session["client"]["complete"]>[0] = {
                ref: refObj,
                argument: { name: argument, value: value ?? "" },
              };
              if (context && Object.keys(context).length > 0) {
                (
                  params as {
                    context?: { arguments: Record<string, string> };
                  }
                ).context = {
                  arguments: context,
                };
              }
              return session.client.complete(params);
            },
          );
        }),
      );
      return { activities };
    }),

  authStatus: serverProcedure
    .input(serverNameInput)
    .query(async ({ ctx }) => {
      const { serverName } = ctx as ServerContext;
      return readAuthStatus(serverName);
    }),

  authLogout: serverProcedure
    .input(serverNameInput)
    .mutation(async ({ ctx }) => {
      const { serverName } = ctx as ServerContext;
      const activity = await runActivity("auth", "logout", () =>
        deleteAuthFile(serverName),
      );
      return { activities: [activity] };
    }),

  authUrl: serverProcedure
    .input(serverNameInput)
    .query(({ ctx }) => {
      const { serverName, pendingAuthUrls } = ctx as ServerContext & {
        pendingAuthUrls: Map<string, string>;
      };
      const url = pendingAuthUrls.get(serverName) ?? null;
      if (url) pendingAuthUrls.delete(serverName);
      return { url };
    }),

  disconnect: serverProcedure
    .input(serverNameInput)
    .mutation(async ({ ctx }) => {
      const { serverName, sessions } = ctx as ServerContext;
      const activity = await runActivity("disconnect", serverName, async () => {
        await sessions.release(serverName, true);
        return { ok: true };
      });
      return { activities: [activity] };
    }),
});
