import { EmptyResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import { createSessionPool, type SessionPool } from "../session-pool.js";
import {
  startSessionServer,
  type SessionTestServer,
} from "./helpers/session-server.js";

describe("createSessionPool", () => {
  let srv: SessionTestServer | null = null;
  let pool: SessionPool | null = null;

  afterEach(async () => {
    await pool?.closeAll();
    pool = null;
    await srv?.close();
    srv = null;
  });

  it("reuses one session (and its session ID) across calls", async () => {
    srv = await startSessionServer();
    pool = createSessionPool();

    const a = await pool.acquire(srv.url);
    await a.client.listTools();
    const b = await pool.acquire(srv.url);
    await b.client.ping();

    expect(srv.sessionIds()).toHaveLength(1);
    const inits = srv.log.filter((r) => r.rpc === "initialize");
    expect(inits).toHaveLength(1);
  });

  it("keeps sync client accessors synchronous through the facade", async () => {
    srv = await startSessionServer();
    pool = createSessionPool();

    const session = await pool.acquire(srv.url);
    const caps = session.client.getServerCapabilities();
    expect(caps).toBeTypeOf("object");
    expect(caps).not.toBeInstanceOf(Promise);
    expect(session.client.getServerVersion()?.name).toBe("session-test");
  });

  it("re-initializes and replays once when the server lost the session", async () => {
    srv = await startSessionServer();
    pool = createSessionPool();

    const session = await pool.acquire(srv.url);
    await session.client.listTools();
    const [oldSid] = srv.sessionIds();

    // Server "restarts": all sessions are gone.
    await srv.wipeSessions();

    const result = await session.client.callTool({
      name: "echo",
      arguments: { text: "still works" },
    });
    expect(result.content).toEqual([{ type: "text", text: "still works" }]);

    const [newSid] = srv.sessionIds();
    expect(newSid).toBeTruthy();
    expect(newSid).not.toBe(oldSid);

    // The failed attempt went out with the old (now invalid) session ID and
    // was answered 404; the replay carried the fresh one.
    const calls = srv.log.filter((r) => r.rpc === "tools/call");
    expect(calls.map((r) => [r.sessionId, r.status])).toEqual([
      [oldSid, 404],
      [newSid, 200],
    ]);
    // Recovery started a brand-new session: a second initialize without ID.
    const inits = srv.log.filter((r) => r.rpc === "initialize");
    expect(inits).toHaveLength(2);
    expect(inits.every((r) => r.sessionId === null)).toBe(true);
  });

  it("does not retry non-session errors", async () => {
    srv = await startSessionServer();
    pool = createSessionPool();

    const session = await pool.acquire(srv.url);
    // Unknown method → JSON-RPC error response, not a session failure.
    await expect(
      session.client.request(
        { method: "tools/bogus", params: {} },
        EmptyResultSchema,
      ),
    ).rejects.toThrow(/-32601|method not found/i);

    const inits = srv.log.filter((r) => r.rpc === "initialize");
    expect(inits).toHaveLength(1);
  });

  it("closeAll terminates pooled sessions server-side", async () => {
    srv = await startSessionServer();
    pool = createSessionPool();

    const session = await pool.acquire(srv.url);
    await session.client.listTools();
    expect(srv.sessionIds()).toHaveLength(1);

    await pool.closeAll();
    pool = null;

    expect(srv.sessionIds()).toHaveLength(0);
    const del = srv.log.filter((r) => r.httpMethod === "DELETE");
    expect(del).toHaveLength(1);
  });
});
