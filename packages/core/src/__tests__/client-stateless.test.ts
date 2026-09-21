import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { connect, type Session } from "../client.js";
import { createSessionPool, type SessionPool } from "../session-pool.js";
import { startStatelessServer } from "./helpers/stateless-server.js";
import { appRouter } from "../trpc/router.js";
import { createCallerFactory } from "../trpc/trpc.js";

describe("MCP 2026-07-28", () => {
  let server: Awaited<ReturnType<typeof startStatelessServer>> | undefined;
  let session: Session | undefined;
  let pool: SessionPool | undefined;

  afterEach(async () => {
    await session?.close();
    session = undefined;
    await pool?.closeAll();
    pool = undefined;
    await server?.close();
    server = undefined;
  });

  it.each(["json", "sse"] as const)("uses stateless requests with %s responses", async (responseMode) => {
    server = await startStatelessServer({ responseMode });
    session = await connect({
      kind: "http", url: new URL(server.url), raw: server.url,
      headers: { "X-Inspector-Test": "custom" },
    }, { quiet: true });
    expect(session.client.getProtocolEra()).toBe("modern");
    expect(session.client.getServerVersion()?.name).toBe("stateless-test");
    expect((await session.client.listTools()).tools[0]?.name).toBe("echo");
    expect(await session.client.callTool({ name: "echo", arguments: { text: "hello" } }))
      .toMatchObject({ content: [{ type: "text", text: "hello" }] });
    expect((await session.client.listResources()).resources).toHaveLength(1);
    expect((await session.client.listResourceTemplates()).resourceTemplates).toEqual([]);
    expect((await session.client.readResource({ uri: "test://example" })).contents)
      .toMatchObject([{ text: "example" }]);
    expect((await session.client.listPrompts()).prompts).toHaveLength(1);
    expect((await session.client.getPrompt({ name: "greet" })).messages).toHaveLength(1);
    await session.close();
    session = undefined;

    expect(server.log[0]?.body.method).toBe("server/discover");
    expect(server.instances()).toBe(server.log.length);
    for (const { method, headers, body } of server.log) {
      expect(method).toBe("POST");
      expect(headers.has("mcp-session-id")).toBe(false);
      expect(headers.has("last-event-id")).toBe(false);
      expect(headers.get("mcp-protocol-version")).toBe("2026-07-28");
      expect(headers.get("mcp-method")).toBe(body.method);
      expect(headers.get("x-inspector-test")).toBe("custom");
      expect(headers.get("accept")).toContain("application/json");
      expect(headers.get("accept")).toContain("text/event-stream");
      expect(body.params?._meta).toMatchObject({
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "mcp-inspector" },
        "io.modelcontextprotocol/clientCapabilities": {
          extensions: { "io.modelcontextprotocol/ui": expect.any(Object) },
        },
      });
      expect(["initialize", "notifications/initialized"]).not.toContain(body.method);
    }
    const call = server.log.find(({ body }) => body.method === "tools/call")!;
    expect(call.headers.get("mcp-name")).toBe("echo");
    expect(call.headers.get("mcp-param-text")).toBe("hello");
  });

  it("does not reconnect or replay stateless HTTP 404 failures", async () => {
    server = await startStatelessServer({ failMethod: "tools/call" });
    pool = createSessionPool();
    const connection = await pool.acquire(server.url);
    await expect(connection.client.callTool({ name: "echo" })).rejects.toThrow();
    expect(server.log.filter(({ body }) => body.method === "tools/call")).toHaveLength(1);
    expect(server.log.filter(({ body }) => body.method === "server/discover")).toHaveLength(1);
  });

  it("sends tool parameter headers through the dashboard API", async () => {
    server = await startStatelessServer();
    pool = createSessionPool();
    const caller = createCallerFactory(appRouter)({
      sessions: pool,
      configOpts: {},
      pendingAuthUrls: new Map(),
    });
    const result = await caller.servers.callTool({
      serverName: server.url,
      items: { name: "echo", arguments: { text: "dashboard" } },
    });
    expect(result.activities[0]?.outcome).toBe("ok");
    expect(result.activities[0]?.result).toMatchObject({
      content: [{ type: "text", text: "dashboard" }],
    });
    const request = server.log.find(({ body }) => body.method === "tools/call")!;
    expect(request.headers.get("mcp-param-text")).toBe("dashboard");
  });

  it.each([403, 503])("does not fall back to initialize on HTTP %s", async (status) => {
    server = await startStatelessServer({ failMethod: "server/discover", status });
    await expect(connect(server.url, { quiet: true })).rejects.toThrow();
    expect(server.log.map(({ body }) => body.method)).toEqual(["server/discover"]);
  });

  it("supports older stateless servers without retrying requests as expired sessions", async () => {
    server = await startStatelessServer({ legacyOnly: true, failMethod: "tools/call" });
    pool = createSessionPool();
    const connection = await pool.acquire(server.url);
    expect(connection.client.getProtocolEra()).toBe("legacy");
    expect(connection.client.transport?.sessionId).toBeUndefined();
    expect((await connection.client.listTools()).tools[0]?.name).toBe("echo");
    await expect(connection.client.callTool({ name: "echo" })).rejects.toThrow();
    await pool.closeAll();
    expect(server.log.filter(({ body }) => body.method === "initialize")).toHaveLength(1);
    expect(server.log.filter(({ body }) => body.method === "tools/call")).toHaveLength(1);
    expect(server.log.some(({ method }) => method === "DELETE")).toBe(false);
  });

  it.each(["modern", "legacy"])("negotiates %s stdio servers", async (era) => {
    session = await connect({
      kind: "stdio",
      command: process.execPath,
      args: [fileURLToPath(new URL("./helpers/stdio-server.mjs", import.meta.url)), era],
      env: { INSPECTOR_TEST_VALUE: "configured" },
      raw: `stdio-${era}`,
    });
    expect(session.client.getProtocolEra()).toBe(era);
    expect(session.client.getServerVersion()?.name).toBe(`stdio-${era}`);
    expect(await session.client.callTool({ name: "echo" })).toMatchObject({
      content: [{ type: "text", text: "configured" }],
    });
  });
});
