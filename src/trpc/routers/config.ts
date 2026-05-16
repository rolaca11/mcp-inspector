import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { TRPCError } from "@trpc/server";

import { configDir } from "../../paths.js";
import { configAddInput, configRemoveInput } from "../schemas.js";
import { publicProcedure, router } from "../trpc.js";

function inspectorConfigPath(): string {
  return path.join(configDir(), "mcp.json");
}

function readInspectorConfig(): Record<string, unknown> {
  const p = inspectorConfigPath();
  if (!existsSync(p)) return {};
  const raw = readFileSync(p, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected a JSON object at top level");
  }
  return parsed as Record<string, unknown>;
}

function writeInspectorConfig(obj: Record<string, unknown>): void {
  const p = inspectorConfigPath();
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function getServersRecord(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const s = obj.mcpServers;
  if (s === undefined) return {};
  if (typeof s !== "object" || s === null || Array.isArray(s)) {
    throw new Error("`mcpServers` must be an object");
  }
  return s as Record<string, unknown>;
}

export const configRouter = router({
  list: publicProcedure.query(() => {
    const obj = readInspectorConfig();
    const servers = getServersRecord(obj);
    return { path: inspectorConfigPath(), servers };
  }),

  add: publicProcedure.input(configAddInput).mutation(({ input }) => {
    const obj = readInspectorConfig();
    const servers = getServersRecord(obj);
    if (input.name in servers && !input.force) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `server "${input.name}" already exists`,
      });
    }
    servers[input.name] = input.config;
    obj.mcpServers = servers;
    writeInspectorConfig(obj);
    return { ok: true as const, name: input.name };
  }),

  remove: publicProcedure.input(configRemoveInput).mutation(({ input }) => {
    const obj = readInspectorConfig();
    const servers = getServersRecord(obj);
    if (!(input.name in servers)) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `server "${input.name}" not found`,
      });
    }
    delete servers[input.name];
    obj.mcpServers = servers;
    writeInspectorConfig(obj);
    return { ok: true as const, name: input.name };
  }),
});
