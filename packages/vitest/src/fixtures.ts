/**
 * `defineMcpTest` plugs an MCP session into vitest's fixture system. The
 * returned `test` carries two fixtures: `mcp` (a wrapped `McpClient`, connected
 * on first use) and `mcpSession` (the raw `Session` behind it). By default a
 * single session is shared across the whole test file and closed afterwards;
 * pass `scope: "test"` for a fresh, isolated session per test. `connect` is
 * injectable (same seam as the session pool) so unit tests need no real server.
 */

import { afterAll, test as baseTest } from "vitest";

import {
  connect,
  type ConnectOptions,
  type Session,
} from "@rolaca11/mcp-inspector-core/client";
import type { TargetSpec } from "@rolaca11/mcp-inspector-core/target";
import { wrap, type McpClient } from "./wrap.js";

export interface McpFixtures {
  /** A wrapped MCP client, connected lazily on first use. */
  mcp: McpClient;
  /** The underlying session backing `mcp`. */
  mcpSession: Session;
}

/** A target string/spec, or a thunk for one known only at runtime (e.g. a
 * test server URL that exists after `beforeAll`). */
export type McpTarget =
  | string
  | TargetSpec
  | (() => string | TargetSpec | Promise<string | TargetSpec>);

export interface DefineMcpTestOptions {
  /** The MCP server to connect to. */
  target: McpTarget;
  /** Forwarded to `connect()` (scope, clientName, quiet, onRedirect). */
  connectOptions?: ConnectOptions;
  /** Injectable connect — defaults to the real one. Matches the session-pool seam. */
  connect?: typeof connect;
  /** "suite" (default): one session per file. "test": a fresh session per test. */
  scope?: "suite" | "test";
}

async function resolveTarget(target: McpTarget): Promise<string | TargetSpec> {
  return typeof target === "function" ? target() : target;
}

/**
 * Build a vitest `test` extended with the `mcp`/`mcpSession` fixtures. Call it
 * at the top level of a file or inside a `describe`; the suite-scoped session is
 * torn down by an `afterAll` registered in that same scope.
 */
export function defineMcpTest(options: DefineMcpTestOptions) {
  const connectFn = options.connect ?? connect;
  const open = async (): Promise<Session> =>
    connectFn(await resolveTarget(options.target), options.connectOptions ?? {});

  const perTest = options.scope === "test";

  // Suite scope: connect once (lazily, on the first test that uses `mcp`) and
  // reuse the session for the whole file, closing it once when the suite ends.
  let shared: Promise<Session> | null = null;
  if (!perTest) {
    afterAll(async () => {
      if (!shared) return;
      const pending = shared;
      shared = null;
      const session = await pending.catch(() => null);
      if (session) await session.close();
    });
  }

  return baseTest.extend<McpFixtures>({
    mcpSession: async ({}, use) => {
      if (perTest) {
        const session = await open();
        try {
          await use(session);
        } finally {
          await session.close();
        }
      } else {
        await use(await (shared ??= open()));
      }
    },
    mcp: async ({ mcpSession }, use) => {
      await use(wrap(mcpSession));
    },
  });
}
