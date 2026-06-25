import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Session } from "@rolaca11/mcp-inspector-core/client";
import {
  coerceIsError,
  completionResult,
  defineMcpTest,
  installMcpMatchers,
  joinText,
  listNames,
  resourceResult,
  toolResult,
  wrap,
} from "../index.js";
import {
  startSessionServer,
  type SessionTestServer,
} from "./helpers/session-server.js";

// This file installs the matchers directly (no setupFiles in this config).
installMcpMatchers();

/* ------------------------------------------------------------------ */
/* normalize — pure helpers                                            */
/* ------------------------------------------------------------------ */

describe("normalize", () => {
  it("joins text across content / contents / messages shapes", () => {
    expect(joinText({ content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] })).toBe("a\nb");
    expect(joinText({ contents: [{ uri: "x", text: "one" }, { uri: "y", blob: "Zm9v" }] })).toBe("one");
    expect(joinText({ messages: [{ role: "user", content: { type: "text", text: "Hi" } }] })).toBe("Hi");
    expect(joinText("not-a-result")).toBe("");
  });

  it("extracts list names with uri / uriTemplate fallbacks", () => {
    expect(listNames({ tools: [{ name: "echo" }, { name: "add" }] })).toEqual(["echo", "add"]);
    expect(listNames({ resources: [{ uri: "test://r" }] })).toEqual(["test://r"]);
    expect(listNames({ resourceTemplates: [{ uriTemplate: "test://{id}" }] })).toEqual(["test://{id}"]);
    expect(listNames({ nope: [] })).toEqual([]);
  });

  it("coerces isError to a strict boolean", () => {
    expect(coerceIsError({ isError: true })).toBe(true);
    expect(coerceIsError({ isError: "true" })).toBe(false);
    expect(coerceIsError({})).toBe(false);
    expect(coerceIsError(null)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* wrap — typed façade with a stubbed client                           */
/* ------------------------------------------------------------------ */

function stubSession(): Session {
  const client = {
    async callTool({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) {
      const a = args ?? {};
      if (name === "echo") return { content: [{ type: "text", text: String(a.message) }] };
      if (name === "add") return { content: [{ type: "text", text: "sum=5" }], structuredContent: { sum: 5 } };
      if (name === "boom") return { content: [{ type: "text", text: "bad input" }], isError: true };
      if (name === "img") return { content: [{ type: "image", data: "Zm9v", mimeType: "image/png" }] };
      throw new Error(`unknown tool ${name}`);
    },
    async readResource({ uri }: { uri: string }) {
      return { contents: [{ uri, mimeType: "text/plain", text: "hello world" }] };
    },
    async getPrompt({ arguments: args }: { name: string; arguments?: Record<string, string> }) {
      return { messages: [{ role: "user", content: { type: "text", text: `Hi ${args?.who}` } }] };
    },
    async listTools() {
      return { tools: [{ name: "echo" }, { name: "add" }] };
    },
    async listResources() {
      return { resources: [{ name: "r", uri: "test://r" }] };
    },
    async listResourceTemplates() {
      return { resourceTemplates: [{ name: "t", uriTemplate: "test://{id}" }] };
    },
    async listPrompts() {
      return { prompts: [{ name: "greet" }] };
    },
    async complete() {
      return { completion: { values: ["Ada", "Alan"], total: 2, hasMore: false } };
    },
    async ping() {
      return {};
    },
  };
  return {
    client,
    target: { kind: "stdio", command: "stub", args: [], raw: "stub" },
    id: "stub",
    async close() {},
  } as unknown as Session;
}

describe("wrap", () => {
  const mcp = wrap(stubSession());

  it("exposes ergonomic tool-result accessors", async () => {
    const res = await mcp.callTool("echo", { message: "hi" });
    expect(res.isError).toBe(false);
    expect(res.text).toBe("hi");
    expect(res.content).toHaveLength(1);
    expect(res.block("text")?.text).toBe("hi");
    expect(res.block("image")).toBeUndefined();
    expect(res.raw.content[0]).toEqual({ type: "text", text: "hi" });
  });

  it("reads structured content and json()", async () => {
    const res = await mcp.callTool("add", { a: 2, b: 3 });
    expect(res.structuredContent).toEqual({ sum: 5 });
    expect(res.json<{ sum: number }>().sum).toBe(5);
  });

  it("surfaces the MCP error channel without throwing", async () => {
    const res = await mcp.callTool("boom");
    expect(res.isError).toBe(true);
    expect(res.text).toBe("bad input");
  });

  it("wraps resources, prompts, lists and completions", async () => {
    const r = await mcp.readResource("test://greeting");
    expect(r.text).toBe("hello world");
    expect(r.mimeType).toBe("text/plain");
    expect(r.blob).toBeUndefined();

    const p = await mcp.getPrompt("greet", { who: "Sam" });
    expect(p.text).toBe("Hi Sam");
    expect(p.roles).toEqual(["user"]);

    const tools = await mcp.listTools();
    expect(tools.names).toEqual(["echo", "add"]);

    const c = await mcp.complete({ ref: { type: "ref/prompt", name: "greet" }, argument: { name: "name", value: "A" } });
    expect(c.values).toEqual(["Ada", "Alan"]);
    expect(c.total).toBe(2);
    expect(c.hasMore).toBe(false);

    // Every wrapper carries the untouched SDK payload on `.raw`.
    expect(r.raw).toEqual({ contents: [{ uri: "test://greeting", mimeType: "text/plain", text: "hello world" }] });
    expect(p.raw.messages).toBe(p.messages);
    expect(tools.raw).toEqual({ tools: [{ name: "echo" }, { name: "add" }] });
    expect(c.raw.completion.values).toBe(c.values);
  });

  it("exposes the raw client + session escape hatches", () => {
    expect(mcp.session.id).toBe("stub");
    expect(typeof mcp.client.callTool).toBe("function");
  });

  it("ping resolves to undefined", async () => {
    await expect(mcp.ping()).resolves.toBeUndefined();
  });
});

describe("result wrappers", () => {
  it("exposes a populated blob accessor for binary resources", () => {
    const res = resourceResult({ contents: [{ uri: "test://img", blob: "Zm9vYmFy", mimeType: "image/png" }] });
    expect(res.blob).toBe("Zm9vYmFy");
    expect(res.mimeType).toBe("image/png");
    expect(res.text).toBe(""); // a blob entry contributes no text
  });

  it("json() returns structuredContent when present, else parses text", () => {
    expect(toolResult({ content: [{ type: "text", text: '{"n":1}' }] }).json<{ n: number }>().n).toBe(1);
    expect(toolResult({ content: [], structuredContent: { n: 2 } }).json<{ n: number }>().n).toBe(2);
  });

  it("json() throws a clear error on non-JSON text", () => {
    expect(() => toolResult({ content: [{ type: "text", text: "not json" }] }).json()).toThrow(/not valid JSON/);
    expect(() => resourceResult({ contents: [{ uri: "x", text: "not json" }] }).json()).toThrow(/not valid JSON/);
  });
});

/* ------------------------------------------------------------------ */
/* matchers                                                            */
/* ------------------------------------------------------------------ */

describe("matchers", () => {
  it("toBeOk / toBeMcpError on wrapped and raw results", () => {
    expect(toolResult({ content: [{ type: "text", text: "ok" }] })).toBeOk();
    expect(toolResult({ content: [{ type: "text", text: "boom" }], isError: true })).toBeMcpError();
    expect(toolResult({ content: [{ type: "text", text: "bad input" }], isError: true })).toBeMcpError(/bad/);
    expect(toolResult({ content: [{ type: "text", text: "x" }] })).not.toBeMcpError();
    // negation of toBeOk: an error result is not ok
    expect(toolResult({ content: [{ type: "text", text: "boom" }], isError: true })).not.toBeOk();
    // raw SDK result works too (duck-typed)
    expect({ content: [{ type: "text", text: "y" }], isError: true }).toBeMcpError();
  });

  it("toHaveText with substring and regex", () => {
    const res = toolResult({ content: [{ type: "text", text: "Echo: hello" }] });
    expect(res).toHaveText("hello");
    expect(res).toHaveText(/^Echo:/);
    expect(res).not.toHaveText("goodbye");
  });

  it("toHaveContentType", () => {
    expect(toolResult({ content: [{ type: "image", data: "Zm9v", mimeType: "image/png" }] })).toHaveContentType("image");
    expect(toolResult({ content: [{ type: "text", text: "x" }] })).not.toHaveContentType("image");
  });

  it("toHaveStructured supports exact and asymmetric matching", () => {
    const res = toolResult({ content: [], structuredContent: { sum: 5, unit: "n" } });
    expect(res).toHaveStructured({ sum: 5, unit: "n" });
    expect(res).toHaveStructured(expect.objectContaining({ sum: 5 }));
    expect(res).not.toHaveStructured({ sum: 6 });
  });

  it("toListName is variadic", () => {
    const tools = { tools: [{ name: "echo" }, { name: "add" }] };
    expect(tools).toListName("echo");
    expect(tools).toListName("echo", "add");
    expect(tools).not.toListName("missing");
    // asserting membership of zero names is meaningless and fails by design
    expect(() => expect(tools).toListName()).toThrow();
  });

  it("toMatchResource checks uri / mimeType / text", () => {
    const res = resourceResult({ contents: [{ uri: "test://greeting", mimeType: "text/plain", text: "hello world" }] });
    expect(res).toMatchResource({ mimeType: "text/plain", text: /hello/ });
    expect(res).toMatchResource({ uri: "test://greeting" });
    expect(res).not.toMatchResource({ mimeType: "application/json" });
  });

  it("produces a readable failure message", () => {
    const res = toolResult({ content: [{ type: "text", text: "actual text" }] });
    expect(() => expect(res).toHaveText("expected text")).toThrow(/expected text/);
  });
});

describe("completionResult helper", () => {
  it("defaults hasMore to false", () => {
    expect(completionResult({ completion: { values: ["a"] } }).hasMore).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* defineMcpTest — unit (injected connect) and e2e (real connect)      */
/* ------------------------------------------------------------------ */

describe("defineMcpTest with an injected connect", () => {
  const test = defineMcpTest({
    scope: "test",
    target: "stub://x",
    connect: async () => stubSession(),
  });

  test("connects via the injected factory and wraps calls", async ({ mcp, mcpSession }) => {
    expect(mcpSession.id).toBe("stub");
    expect(await mcp.callTool("echo", { message: "stubbed" })).toHaveText("stubbed");
  });
});

describe("defineMcpTest scope:'test' opens and closes a session per test", () => {
  let opened = 0;
  let closed = 0;
  const test = defineMcpTest({
    scope: "test",
    target: "stub://x",
    connect: async () => {
      opened++;
      const session = stubSession();
      const realClose = session.close.bind(session);
      session.close = async () => {
        closed++;
        await realClose();
      };
      return session;
    },
  });

  test("first test gets its own session", async ({ mcp }) => {
    expect(await mcp.callTool("echo", { message: "a" })).toHaveText("a");
  });

  test("second test gets another, freshly opened session", async ({ mcp }) => {
    expect(await mcp.callTool("echo", { message: "b" })).toHaveText("b");
  });

  afterAll(() => {
    // Each test opened a fresh session and closed it on teardown.
    expect(opened).toBe(2);
    expect(closed).toBe(2);
  });
});

describe("defineMcpTest against a real in-memory MCP server", () => {
  let srv: SessionTestServer;
  let tmpDir = "";
  let originalXDG: string | undefined;

  beforeAll(async () => {
    originalXDG = process.env.XDG_CONFIG_HOME;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-vitest-"));
    process.env.XDG_CONFIG_HOME = tmpDir;
    srv = await startSessionServer();
    return async () => {
      await srv.close();
      if (originalXDG === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalXDG;
      await fs.rm(tmpDir, { recursive: true, force: true });
    };
  });

  // Suite-scoped: one shared session for the whole block. The target is a thunk
  // so it can read srv.url, which only exists after beforeAll resolves.
  const test = defineMcpTest({ target: () => srv.url, connectOptions: { quiet: true } });

  test("echo tool round-trips text", async ({ mcp }) => {
    const res = await mcp.callTool("echo", { text: "hello world" });
    expect(res).toBeOk();
    expect(res).toHaveText(/hello/);
    expect(res).toHaveContentType("text");
  });

  test("add returns structured content", async ({ mcp }) => {
    const res = await mcp.callTool("add", { a: 2, b: 3 });
    expect(res).toBeOk();
    expect(res).toHaveStructured({ sum: 5 });
    expect(res.json<{ sum: number }>().sum).toBe(5);
  });

  test("boom reports an error on the MCP error channel", async ({ mcp }) => {
    expect(await mcp.callTool("boom")).toBeMcpError(/kaboom/);
  });

  test("lists tools, reads a resource, gets a prompt, completes", async ({ mcp }) => {
    expect(await mcp.listTools()).toListName("echo", "add", "boom");

    const r = await mcp.readResource("test://greeting");
    expect(r).toMatchResource({ mimeType: "text/plain", text: "hello world" });

    const p = await mcp.getPrompt("greet", { name: "Ada" });
    expect(p).toHaveText("Hi Ada");

    const c = await mcp.complete({
      ref: { type: "ref/prompt", name: "greet" },
      argument: { name: "name", value: "A" },
    });
    expect(c.values).toContain("Ada");
  });

  it("reuses one session across the suite-scoped tests", () => {
    // After the tests above ran against the shared session, the server should
    // have negotiated exactly one session id.
    expect(srv.sessionIds().length).toBe(1);
    expect(srv.log.filter((r) => r.rpc === "initialize")).toHaveLength(1);
  });
});
