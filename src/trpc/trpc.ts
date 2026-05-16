import { initTRPC, TRPCError } from "@trpc/server";

import type { Session } from "../client.js";
import { loadConfigSync, type LoadedConfig } from "../config.js";
import { setLoadedConfig } from "../target.js";

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

export interface SessionPool {
  acquire(name: string): Promise<Session>;
  release(name: string, hard?: boolean): Promise<void>;
}

export interface TRPCContext {
  sessions: SessionPool;
  pendingAuthUrls: Map<string, string>;
  configOpts: { extraFiles?: string[] };
}

/* ------------------------------------------------------------------ */
/* tRPC initialisation                                                 */
/* ------------------------------------------------------------------ */

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
export const createCallerFactory = t.createCallerFactory;

/* ------------------------------------------------------------------ */
/* Shared middleware: resolve server name + reload config               */
/* ------------------------------------------------------------------ */

function looksLikeRawTarget(name: string): boolean {
  return /^https?:\/\//.test(name) || /\s/.test(name);
}

export const withServer = middleware(async ({ ctx, getRawInput, next }) => {
  const config = loadConfigSync(ctx.configOpts);
  setLoadedConfig(config);

  const raw = await getRawInput();
  const { serverName } = raw as { serverName: string };
  const entry = config.servers.get(serverName);
  if (!entry && !looksLikeRawTarget(serverName)) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `unknown server: ${serverName}`,
    });
  }

  return next({ ctx: { ...ctx, config, serverName } });
});

export const withSession = withServer.unstable_pipe(async ({ ctx, next }) => {
  const session = await ctx.sessions.acquire(
    (ctx as typeof ctx & { serverName: string }).serverName,
  );
  return next({
    ctx: {
      ...ctx,
      session,
    },
  });
});

export const serverProcedure = publicProcedure.use(withServer);
export const sessionProcedure = publicProcedure.use(withSession);

export type ServerContext = TRPCContext & {
  config: LoadedConfig;
  serverName: string;
};
export type SessionContext = ServerContext & { session: Session };
