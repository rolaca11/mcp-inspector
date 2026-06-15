import { afterEach, describe, expect, it } from "vitest";

import { connect, type Session } from "../client.js";
import {
  startSessionServer,
  type SessionTestServer,
} from "./helpers/session-server.js";

describe("MCP session ID handling", () => {
  let srv: SessionTestServer | null = null;
  let session: Session | null = null;

  afterEach(async () => {
    await session?.close().catch(() => {});
    session = null;
    await srv?.close();
    srv = null;
  });

  it("sends the negotiated session ID on every request after initialize", async () => {
    srv = await startSessionServer();
    session = await connect(srv.url, { quiet: true });

    await session.client.listTools();
    await session.client.callTool({ name: "echo", arguments: { text: "hi" } });
    await session.client.ping();

    const [sid] = srv.sessionIds();
    expect(sid).toBeTruthy();

    const init = srv.log.filter((r) => r.rpc === "initialize");
    expect(init).toHaveLength(1);
    // The session ID is born in the initialize response, so that request
    // correctly carries none.
    expect(init[0]!.sessionId).toBeNull();

    const rest = srv.log.filter((r) => r.rpc !== "initialize");
    expect(rest.length).toBeGreaterThanOrEqual(4); // initialized, list, call, ping
    for (const r of rest) {
      expect(r.sessionId).toBe(sid);
    }
  });

  it("terminates the session with a DELETE carrying the session ID on close", async () => {
    srv = await startSessionServer();
    session = await connect(srv.url, { quiet: true });
    await session.client.listTools();

    const [sid] = srv.sessionIds();
    await session.close();
    session = null;

    const del = srv.log.filter((r) => r.httpMethod === "DELETE");
    expect(del).toHaveLength(1);
    expect(del[0]!.sessionId).toBe(sid);
    expect(del[0]!.status).toBe(200);
    // The server reclaimed the session.
    expect(srv.sessionIds()).toHaveLength(0);
  });

  it("close tolerates servers that already dropped the session", async () => {
    srv = await startSessionServer();
    session = await connect(srv.url, { quiet: true });
    await session.client.listTools();

    await srv.wipeSessions();
    await expect(session.close()).resolves.toBeUndefined();
    session = null;
  });
});
