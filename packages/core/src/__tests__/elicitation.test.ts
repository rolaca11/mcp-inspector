import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  inputRequired,
  inputResponse,
  type McpServer,
} from "@modelcontextprotocol/server";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer as LegacyMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { connect, type ConnectOptions, type Session } from "../client.js";
import {
  describeElicitationForm,
  extractUrlElicitationError,
  normalizeElicitationParams,
  normalizeElicitationResult,
  validateElicitationFormContent,
  validateElicitationUrl,
  type ElicitationFormParams,
  type ElicitationHandler,
  type ElicitationRequestedSchema,
  type ElicitationRequestParams,
  type ElicitationResult,
} from "../elicitation.js";
import { createElicitationBroker, type ElicitationBroker } from "../elicitation-broker.js";
import { errorMessage } from "../format.js";
import { createSessionPool, type SessionPool } from "../session-pool.js";
import { runSuites } from "../testing/index.js";
import { appRouter } from "../trpc/router.js";
import { createCallerFactory, type TRPCContext } from "../trpc/trpc.js";
import { startSessionServer, type SessionTestServer } from "./helpers/session-server.js";
import { startStatelessServer } from "./helpers/stateless-server.js";

const createCaller = createCallerFactory(appRouter);

async function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

function jsonOf(result: unknown): unknown {
  return JSON.parse(textOf(result));
}

const allVariantsSchema: ElicitationRequestedSchema = {
  type: "object",
  properties: {
    agree: { type: "boolean", title: "Agree", default: false },
    name: { type: "string", title: "Name", minLength: 2, maxLength: 5 },
    email: { type: "string", format: "email" },
    site: { type: "string", format: "uri" },
    birthday: { type: "string", format: "date" },
    meeting: { type: "string", format: "date-time" },
    score: { type: "number", minimum: 0, maximum: 10 },
    count: { type: "integer", minimum: 1, default: 3 },
    color: { type: "string", enum: ["red", "green"] },
    size: { type: "string", oneOf: [{ const: "s", title: "Small" }, { const: "l", title: "Large" }] },
    legacy: { type: "string", enum: ["a", "b"], enumNames: ["Alpha", "Beta"] },
    tags: { type: "array", minItems: 1, maxItems: 2, items: { type: "string", enum: ["x", "y", "z"] } },
    roles: {
      type: "array",
      items: { anyOf: [{ const: "admin", title: "Admin" }, { const: "dev", title: "Developer" }] },
      default: ["dev"],
    },
  },
  required: ["name", "tags"],
};

describe("elicitation schema helpers", () => {
  it("describes all eight primitive schema variants", () => {
    const fields = Object.fromEntries(
      describeElicitationForm(allVariantsSchema).map((field) => [field.name, field]),
    );
    expect(fields.agree).toMatchObject({ kind: "boolean", label: "Agree", default: false, required: false });
    expect(fields.name).toMatchObject({ kind: "string", minLength: 2, maxLength: 5, required: true });
    expect(fields.email).toMatchObject({ kind: "string", label: "email", format: "email" });
    expect(fields.score).toMatchObject({ kind: "number", minimum: 0, maximum: 10 });
    expect(fields.count).toMatchObject({ kind: "integer", minimum: 1, default: 3 });
    expect(fields.color).toMatchObject({
      kind: "single-enum",
      options: [{ value: "red", label: "red" }, { value: "green", label: "green" }],
    });
    expect(fields.size).toMatchObject({
      kind: "single-enum",
      options: [{ value: "s", label: "Small" }, { value: "l", label: "Large" }],
    });
    expect(fields.legacy).toMatchObject({
      kind: "single-enum",
      options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }],
    });
    expect(fields.tags).toMatchObject({
      kind: "multi-enum",
      minItems: 1,
      maxItems: 2,
      options: [{ value: "x", label: "x" }, { value: "y", label: "y" }, { value: "z", label: "z" }],
    });
    expect(fields.roles).toMatchObject({
      kind: "multi-enum",
      default: ["dev"],
      options: [{ value: "admin", label: "Admin" }, { value: "dev", label: "Developer" }],
    });
  });

  it("accepts valid content, applies defaults, and drops empty optional keys", () => {
    const result = validateElicitationFormContent(allVariantsSchema, {
      name: "Ada",
      email: "ada@example.com",
      site: "https://example.com/x",
      birthday: "2024-02-29",
      meeting: "2026-11-25T09:30:00.5+01:00",
      score: 7.5,
      color: "green",
      size: "l",
      legacy: "b",
      tags: ["x", "z"],
      extra: "ignored",
      email2: "",
    });
    expect(result).toEqual({
      ok: true,
      content: {
        agree: false,
        name: "Ada",
        email: "ada@example.com",
        site: "https://example.com/x",
        birthday: "2024-02-29",
        meeting: "2026-11-25T09:30:00.5+01:00",
        score: 7.5,
        count: 3,
        color: "green",
        size: "l",
        legacy: "b",
        tags: ["x", "z"],
        roles: ["dev"],
      },
    });
  });

  it("reports every invalid field", () => {
    const result = validateElicitationFormContent(allVariantsSchema, {
      agree: "yes",
      name: "A",
      email: "not-an-email",
      site: "no scheme",
      birthday: "2023-02-29",
      meeting: "2026-11-25T09:30:00",
      score: 11,
      count: 1.5,
      color: "blue",
      size: "m",
      legacy: "Alpha",
      tags: ["x", "y", "z"],
      roles: ["root"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      ["agree", "name", "email", "site", "birthday", "meeting", "score", "count", "color", "size", "legacy", "tags", "roles"].sort(),
    );
    expect(result.errors.count).toMatch(/whole number/);
    expect(result.errors.tags).toMatch(/at most 2/);
  });

  it("requires required fields and enforces minItems", () => {
    const result = validateElicitationFormContent(allVariantsSchema, { tags: [] });
    expect(result).toEqual({
      ok: false,
      errors: { name: "This field is required", tags: "This field is required" },
    });
    const name = validateElicitationFormContent(allVariantsSchema, { name: "Bob", tags: ["x"], maxLen: 1 });
    expect(name.ok).toBe(true);
  });

  it.each([
    ["2026-13-01T00:00:00Z", false],
    ["2026-01-01T24:00:00Z", false],
    ["2026-01-01T23:59:60Z", true],
    ["2026-01-01t10:00:00z", true],
    ["2026-01-01T10:00:00+25:00", false],
  ])("validates date-time %s", (meeting, ok) => {
    const result = validateElicitationFormContent(
      { type: "object", properties: { meeting: { type: "string", format: "date-time" } } },
      { meeting },
    );
    expect(result.ok).toBe(ok);
  });

  it("defaults omitted modes to form", () => {
    const params = normalizeElicitationParams({
      message: "Hi",
      requestedSchema: { type: "object", properties: {} },
    });
    expect(params.mode).toBe("form");
    expect(normalizeElicitationParams({ mode: "url", message: "Go", url: "https://x.test" }).mode).toBe("url");
  });

  it("strips content unless a form elicitation is accepted", () => {
    const content = { a: "b" };
    expect(normalizeElicitationResult({ mode: "form" }, { action: "accept", content })).toEqual({ action: "accept", content });
    expect(normalizeElicitationResult({ mode: "form" }, { action: "decline", content })).toEqual({ action: "decline" });
    expect(normalizeElicitationResult({ mode: "url" }, { action: "accept", content })).toEqual({ action: "accept" });
  });

  it("only allows http and https elicitation URLs", () => {
    expect(validateElicitationUrl("https://auth.example.com:8443/path?x=1")).toMatchObject({
      valid: true,
      origin: "https://auth.example.com:8443",
      host: "auth.example.com:8443",
    });
    expect(validateElicitationUrl("http://localhost/x").valid).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "not a url"]) {
      expect(validateElicitationUrl(bad).valid).toBe(false);
    }
  });

  it("extracts -32042 URL elicitation errors from the cause chain", () => {
    const inner = Object.assign(new Error("Authorization needed"), {
      code: -32042,
      data: {
        elicitations: [
          { mode: "url", message: "Connect GitHub", url: "https://github.test/auth", elicitationId: "gh-1" },
          { mode: "url", message: "bad" },
        ],
      },
    });
    const outer = new Error("tool failed", { cause: inner });
    expect(extractUrlElicitationError(outer)).toEqual({
      message: "Authorization needed",
      elicitations: [
        { mode: "url", message: "Connect GitHub", url: "https://github.test/auth", elicitationId: "gh-1" },
      ],
    });
    expect(extractUrlElicitationError(new Error("plain"))).toBeNull();
    expect(extractUrlElicitationError({ code: -32042, data: {} })).toBeNull();
    expect(errorMessage(outer)).toBe(
      "Authorization needed\n  - Connect GitHub: https://github.test/auth (elicitationId: gh-1)",
    );
  });
});

const formParams = (message: string): ElicitationFormParams => ({
  mode: "form",
  message,
  requestedSchema: { type: "object", properties: { name: { type: "string" } } },
});

describe("createElicitationBroker", () => {
  it("queues concurrent requests per server in FIFO order", async () => {
    const broker = createElicitationBroker();
    const first = broker.request("a", formParams("one"));
    const second = broker.request("a", formParams("two"));
    const other = broker.request("b", { mode: "url", message: "three", url: "https://x.test" });

    const { pending } = broker.list("a");
    expect(pending.map((p) => p.params.message)).toEqual(["one", "two"]);
    expect(broker.list().pending).toHaveLength(3);
    expect(broker.hasPending("a")).toBe(true);
    expect(pending[0]!.createdAt).toMatch(/^\d{4}-/);

    const response = broker.respond(pending[1]!.id, { action: "accept", content: { name: "x" } });
    expect(response).toMatchObject({ ok: true, serverName: "a", result: { action: "accept", content: { name: "x" } } });
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
    await expect(second).resolves.toEqual({ action: "accept", content: { name: "x" } });

    broker.respond(pending[0]!.id, { action: "decline" });
    await expect(first).resolves.toEqual({ action: "decline" });

    const urlId = broker.list("b").pending[0]!.id;
    broker.respond(urlId, { action: "accept" });
    await expect(other).resolves.toEqual({ action: "accept" });
    expect(broker.hasPending("a")).toBe(false);
    expect(() => broker.respond(urlId, { action: "accept" })).toThrow(/No pending elicitation/);
  });

  it("rejects and removes requests when the signal aborts", async () => {
    const broker = createElicitationBroker();
    const controller = new AbortController();
    const promise = broker.request("a", formParams("x"), { signal: controller.signal });
    expect(broker.hasPending("a")).toBe(true);
    controller.abort(new Error("server cancelled"));
    await expect(promise).rejects.toThrow("server cancelled");
    expect(broker.list().pending).toEqual([]);

    await expect(broker.request("a", formParams("y"), { signal: controller.signal })).rejects.toThrow("server cancelled");
    expect(broker.list().pending).toEqual([]);
  });

  it("cancels requests per server and globally", async () => {
    const broker = createElicitationBroker();
    const a = broker.request("a", formParams("a"));
    const b = broker.request("b", formParams("b"));
    broker.cancelForServer("a", "Session closed");
    await expect(a).rejects.toThrow("Session closed");
    expect(broker.list().pending.map((p) => p.serverName)).toEqual(["b"]);
    broker.cancelAll("bye");
    await expect(b).rejects.toThrow("bye");
    expect(broker.list().pending).toEqual([]);
  });

  it("keeps a bounded list of completion notifications", () => {
    const broker = createElicitationBroker();
    for (let i = 0; i < 60; i++) broker.recordCompletion(i % 2 ? "a" : "b", `id-${i}`);
    expect(broker.list().completions).toHaveLength(50);
    expect(broker.list().completions[0]!.elicitationId).toBe("id-10");
    expect(broker.list("a").completions.every((c) => c.serverName === "a")).toBe(true);
  });
});

const nameSchema = {
  type: "object" as const,
  properties: {
    name: { type: "string" as const, title: "Name" },
    color: { type: "string" as const, enum: ["red", "blue"], default: "blue" },
  },
  required: ["name"],
};

function configureModern(server: McpServer) {
  server.registerTool("greet", { inputSchema: z.object({}) }, async (_args, ctx) => {
    const response = inputResponse(ctx.mcpReq.inputResponses, "who");
    if (response.kind === "missing") {
      return inputRequired({
        inputRequests: { who: inputRequired.elicit({ message: "Who are you?", requestedSchema: nameSchema }) },
      });
    }
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  });

  server.registerTool("wizard", { inputSchema: z.object({}) }, async (_args, ctx) => {
    const state = ctx.mcpReq.requestState<string>();
    const step = inputResponse(ctx.mcpReq.inputResponses, "step");
    if (!state) {
      return inputRequired({
        requestState: "round-1",
        inputRequests: {
          step: inputRequired.elicit({
            message: "Round 1",
            requestedSchema: { type: "object", properties: { first: { type: "string" } }, required: ["first"] },
          }),
        },
      });
    }
    if (state === "round-1" && step.kind === "elicit") {
      return inputRequired({
        requestState: `round-2:${String(step.content?.first)}`,
        inputRequests: {
          step: inputRequired.elicit({
            message: "Round 2",
            requestedSchema: { type: "object", properties: { second: { type: "integer" } }, required: ["second"] },
          }),
        },
      });
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ state, step }) }],
    };
  });

  server.registerTool("pair", { inputSchema: z.object({}) }, async (_args, ctx) => {
    const left = inputResponse(ctx.mcpReq.inputResponses, "left");
    const right = inputResponse(ctx.mcpReq.inputResponses, "right");
    if (left.kind === "missing" || right.kind === "missing") {
      return inputRequired({
        inputRequests: {
          left: inputRequired.elicit({ message: "Left", requestedSchema: nameSchema }),
          right: inputRequired.elicit({ message: "Right", requestedSchema: nameSchema }),
        },
      });
    }
    return { content: [{ type: "text", text: JSON.stringify({ left, right }) }] };
  });

  server.registerTool("authorize", { inputSchema: z.object({}) }, async (_args, ctx) => {
    const response = inputResponse(ctx.mcpReq.inputResponses, "auth");
    if (response.kind === "missing") {
      return inputRequired({
        inputRequests: {
          auth: inputRequired.elicitUrl({ message: "Sign in", url: "https://auth.example.test/start" }),
        },
      });
    }
    return { content: [{ type: "text", text: JSON.stringify(response) }] };
  });

  server.registerPrompt("ask", { argsSchema: z.object({}) }, async (_args, ctx) => {
    const response = inputResponse(ctx.mcpReq.inputResponses, "topic");
    if (response.kind === "missing") {
      return inputRequired({
        inputRequests: {
          topic: inputRequired.elicit({
            message: "Topic?",
            requestedSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
          }),
        },
      });
    }
    return {
      messages: [{ role: "user", content: { type: "text", text: `topic: ${String(response.kind === "elicit" ? response.content?.topic : "")}` } }],
    };
  });
}

function scripted(responses: ElicitationResult[], seen: ElicitationRequestParams[] = []): ElicitationHandler {
  return async (params) => {
    seen.push(params);
    const next = responses.shift();
    if (!next) throw new Error("no scripted response");
    return next;
  };
}

describe("elicitation against a 2026-07-28 stateless server", () => {
  let server: Awaited<ReturnType<typeof startStatelessServer>> | undefined;
  let session: Session | undefined;

  afterEach(async () => {
    await session?.close();
    session = undefined;
    await server?.close();
    server = undefined;
  });

  async function open(elicitation?: ConnectOptions["elicitation"]) {
    server = await startStatelessServer({ configure: configureModern });
    session = await connect(server.url, { quiet: true, ...(elicitation ? { elicitation } : {}) });
    expect(session.client.getProtocolEra()).toBe("modern");
    return session;
  }

  it("advertises form and url elicitation only when a handler is given", async () => {
    const s = await open({ handler: scripted([]) });
    await s.client.listTools();
    const caps = server!.log.at(-1)!.body.params?._meta?.["io.modelcontextprotocol/clientCapabilities"];
    expect(caps).toMatchObject({ elicitation: { form: { applyDefaults: true }, url: {} } });
    await session!.close();
    session = await connect(server!.url, { quiet: true });
    await session.client.listTools();
    const bare = server!.log.at(-1)!.body.params?._meta?.["io.modelcontextprotocol/clientCapabilities"] as Record<string, unknown>;
    expect(bare.elicitation).toBeUndefined();
    expect(bare.extensions).toBeDefined();
  });

  it("can advertise only one elicitation mode", async () => {
    server = await startStatelessServer({ configure: configureModern });
    session = await connect(server.url, { quiet: true, elicitation: { handler: scripted([]), modes: { url: false } } });
    await session.client.listTools();
    const caps = server.log.at(-1)!.body.params?._meta?.["io.modelcontextprotocol/clientCapabilities"];
    expect(caps).toMatchObject({ elicitation: { form: { applyDefaults: true } } });
    expect((caps as { elicitation: Record<string, unknown> }).elicitation.url).toBeUndefined();
  });

  it("fulfils a form elicitation and applies schema defaults", async () => {
    const seen: ElicitationRequestParams[] = [];
    const s = await open({ handler: scripted([{ action: "accept", content: { name: "Ada" } }], seen) });
    const result = await s.client.callTool({ name: "greet", arguments: {} });
    expect(jsonOf(result)).toEqual({ kind: "elicit", action: "accept", content: { name: "Ada", color: "blue" } });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ mode: "form", message: "Who are you?", requestedSchema: { required: ["name"] } });
  });

  it.each(["decline", "cancel"] as const)("passes %s through without content", async (action) => {
    const s = await open({ handler: scripted([{ action, content: { name: "leak" } }]) });
    const result = await s.client.callTool({ name: "greet", arguments: {} });
    expect(jsonOf(result)).toEqual({ kind: "elicit", action });
  });

  it("drives multi-round elicitation with requestState", async () => {
    const seen: ElicitationRequestParams[] = [];
    const s = await open({
      handler: scripted(
        [
          { action: "accept", content: { first: "one" } },
          { action: "accept", content: { second: 2 } },
        ],
        seen,
      ),
    });
    const result = await s.client.callTool({ name: "wizard", arguments: {} });
    expect(jsonOf(result)).toEqual({
      state: "round-2:one",
      step: { kind: "elicit", action: "accept", content: { second: 2 } },
    });
    expect(seen.map((p) => p.message)).toEqual(["Round 1", "Round 2"]);
  });

  it("fulfils parallel inputRequests in one round", async () => {
    const seen: ElicitationRequestParams[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    const handler: ElicitationHandler = async (params) => {
      seen.push(params);
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
      return { action: "accept", content: { name: params.message.toLowerCase() } };
    };
    const s = await open({ handler });
    const result = await s.client.callTool({ name: "pair", arguments: {} });
    expect(jsonOf(result)).toEqual({
      left: { kind: "elicit", action: "accept", content: { name: "left", color: "blue" } },
      right: { kind: "elicit", action: "accept", content: { name: "right", color: "blue" } },
    });
    expect(seen.map((p) => p.message).sort()).toEqual(["Left", "Right"]);
    expect(maxConcurrent).toBe(2);
  });

  it("fulfils URL-mode elicitation without an elicitationId", async () => {
    const seen: ElicitationRequestParams[] = [];
    const s = await open({ handler: scripted([{ action: "accept", content: { ignored: true } }], seen) });
    const result = await s.client.callTool({ name: "authorize", arguments: {} });
    expect(jsonOf(result)).toEqual({ kind: "elicit", action: "accept" });
    expect(seen[0]).toMatchObject({ mode: "url", message: "Sign in", url: "https://auth.example.test/start" });
    expect(seen[0]).not.toHaveProperty("elicitationId");
  });

  it("fulfils elicitation for prompts/get", async () => {
    const s = await open({ handler: scripted([{ action: "accept", content: { topic: "bees" } }]) });
    const prompt = await s.client.getPrompt({ name: "ask", arguments: {} });
    expect(prompt.messages[0]?.content).toMatchObject({ text: "topic: bees" });
  });

  it("blocks callTool through the dashboard API until the user responds", async () => {
    server = await startStatelessServer({ configure: configureModern });
    const broker = createElicitationBroker();
    const pool = createSessionPool({ elicitations: broker });
    try {
      const caller = createCaller({ sessions: pool, pendingAuthUrls: new Map(), configOpts: {}, elicitations: broker });
      const call = caller.servers.callTool({ serverName: server.url, items: { name: "greet", arguments: {} } });
      await waitFor(() => broker.hasPending(server!.url));
      const { pending } = await caller.elicitations.pending({ serverName: server.url });
      expect(pending[0]).toMatchObject({ serverName: server.url, params: { mode: "form", message: "Who are you?" } });

      await expect(
        caller.elicitations.respond({ id: pending[0]!.id, action: "accept", content: { color: "red" } }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      const response = await caller.elicitations.respond({ id: pending[0]!.id, action: "accept", content: { name: "Grace" } });
      expect(response.result).toEqual({ action: "accept", content: { name: "Grace", color: "blue" } });
      const result = await call;
      expect(result.activities[0]?.outcome).toBe("ok");
      expect(jsonOf(result.activities[0]?.result)).toEqual({
        kind: "elicit",
        action: "accept",
        content: { name: "Grace", color: "blue" },
      });
      await expect(caller.elicitations.respond({ id: pending[0]!.id, action: "decline" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    } finally {
      await pool.closeAll();
    }
  });

  it("cancels a pending 2026-07-28 elicitation when the caller signal aborts", async () => {
    server = await startStatelessServer({ configure: configureModern });
    const broker = createElicitationBroker();
    const pool = createSessionPool({ elicitations: broker });
    try {
      const ac = new AbortController();
      const caller = createCaller(
        { sessions: pool, pendingAuthUrls: new Map(), configOpts: {}, elicitations: broker },
        { signal: ac.signal },
      );
      const call = caller.servers.callTool({ serverName: server.url, items: { name: "greet", arguments: {} } });
      await waitFor(() => broker.hasPending(server!.url));
      ac.abort(new Error("browser closed"));
      const result = await call;
      expect(result.activities[0]?.outcome).toBe("error");
      await waitFor(() => !broker.hasPending(server!.url));
      expect(broker.list(server.url).pending).toEqual([]);
    } finally {
      await pool.closeAll();
    }
  });
});

const legacySchema = {
  type: "object" as const,
  properties: {
    city: { type: "string" as const, title: "City" },
    units: { type: "string" as const, enum: ["metric", "imperial"], default: "metric" },
  },
  required: ["city"],
};

function configureLegacy(mcp: LegacyMcpServer) {
  mcp.registerTool("weather", { description: "weather" }, async (extra) => {
    const result = await mcp.server.elicitInput(
      { mode: "form", message: "Which city?", requestedSchema: legacySchema },
      { relatedRequestId: extra.requestId },
    );
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });
  mcp.registerTool("slow_weather", { description: "slow weather" }, async (extra) => {
    const result = await mcp.server.elicitInput(
      { mode: "form", message: "Which city?", requestedSchema: legacySchema },
      { relatedRequestId: extra.requestId },
    );
    await new Promise((r) => setTimeout(r, 80));
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });
  mcp.registerTool("connect_account", { description: "url" }, async (extra) => {
    const result = await mcp.server.elicitInput(
      { mode: "url", message: "Connect your account", url: "https://legacy.example.test/oauth", elicitationId: "legacy-1" },
      { relatedRequestId: extra.requestId },
    );
    if (result.action === "accept") {
      await mcp.server.createElicitationCompletionNotifier("legacy-1", { relatedRequestId: extra.requestId })();
    }
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });
  mcp.registerTool("needs_url", { description: "throws -32042" }, async () => {
    throw new UrlElicitationRequiredError([
      { mode: "url", message: "Authorize billing", url: "https://billing.example.test/auth", elicitationId: "bill-7" },
    ]);
  });
}

describe("elicitation against a 2025-11-25 stateful server", () => {
  let srv: SessionTestServer | undefined;
  let session: Session | undefined;
  let pool: SessionPool | undefined;

  afterEach(async () => {
    await session?.close();
    session = undefined;
    await pool?.closeAll();
    pool = undefined;
    await srv?.close();
    srv = undefined;
  });

  it("fulfils form-mode elicitInput with defaults applied", async () => {
    srv = await startSessionServer({ configure: configureLegacy });
    const seen: ElicitationRequestParams[] = [];
    session = await connect(srv.url, {
      quiet: true,
      elicitation: { handler: scripted([{ action: "accept", content: { city: "Oslo" } }], seen) },
    });
    expect(session.client.getProtocolEra()).toBe("legacy");
    const result = await session.client.callTool({ name: "weather", arguments: {} });
    expect(jsonOf(result)).toEqual({ action: "accept", content: { city: "Oslo", units: "metric" } });
    expect(seen[0]).toMatchObject({ mode: "form", message: "Which city?" });
  });

  it("fulfils URL-mode elicitInput and records the completion notification", async () => {
    srv = await startSessionServer({ configure: configureLegacy });
    const seen: ElicitationRequestParams[] = [];
    const completed: string[] = [];
    session = await connect(srv.url, {
      quiet: true,
      elicitation: {
        handler: scripted([{ action: "accept" }], seen),
        onComplete: (id) => completed.push(id),
      },
    });
    const result = await session.client.callTool({ name: "connect_account", arguments: {} });
    expect(jsonOf(result)).toEqual({ action: "accept" });
    expect(seen[0]).toEqual(
      expect.objectContaining({ mode: "url", url: "https://legacy.example.test/oauth", elicitationId: "legacy-1" }),
    );
    await waitFor(() => completed.length > 0);
    expect(completed).toEqual(["legacy-1"]);
  });

  it("surfaces UrlElicitationRequiredError as readable errors and activity metadata", async () => {
    srv = await startSessionServer({ configure: configureLegacy });
    session = await connect(srv.url, { quiet: true, elicitation: { handler: scripted([]) } });
    const error = await session.client.callTool({ name: "needs_url", arguments: {} }).catch((e: unknown) => e);
    expect(extractUrlElicitationError(error)?.elicitations).toEqual([
      { mode: "url", message: "Authorize billing", url: "https://billing.example.test/auth", elicitationId: "bill-7" },
    ]);
    expect(errorMessage(error)).toContain("Authorize billing: https://billing.example.test/auth (elicitationId: bill-7)");

    const broker = createElicitationBroker();
    pool = createSessionPool({ elicitations: broker });
    const caller = createCaller({ sessions: pool, pendingAuthUrls: new Map(), configOpts: {}, elicitations: broker });
    const response = await caller.servers.callTool({ serverName: srv.url, items: { name: "needs_url" } });
    expect(response.activities[0]).toMatchObject({
      outcome: "error",
      urlElicitations: [{ mode: "url", url: "https://billing.example.test/auth", elicitationId: "bill-7" }],
    });
  });

  it("records completions in the broker through the session pool", async () => {
    srv = await startSessionServer({ configure: configureLegacy });
    const broker = createElicitationBroker();
    pool = createSessionPool({ elicitations: broker });
    const caller = createCaller({ sessions: pool, pendingAuthUrls: new Map(), configOpts: {}, elicitations: broker });
    const call = caller.servers.callTool({ serverName: srv.url, items: { name: "connect_account" } });
    const pending = await waitFor(() => broker.list(srv!.url).pending[0]);
    expect(pending.params).toMatchObject({ mode: "url", elicitationId: "legacy-1" });
    await caller.elicitations.respond({ id: pending.id, action: "accept" });
    expect((await call).activities[0]?.outcome).toBe("ok");
    await waitFor(() => broker.list(srv!.url).completions.length > 0);
    expect(broker.list(srv.url).completions[0]).toMatchObject({ serverName: srv.url, elicitationId: "legacy-1" });
  });

  it("does not idle-evict a session while an elicitation is pending or a call is in flight", async () => {
    srv = await startSessionServer({ configure: configureLegacy });
    const broker = createElicitationBroker();
    pool = createSessionPool({ elicitations: broker, idleMs: 30 });
    const s = await pool.acquire(srv.url);
    const call = s.client.callTool({ name: "slow_weather", arguments: {} });
    const pending = await waitFor(() => broker.list().pending[0]);
    await new Promise((r) => setTimeout(r, 100));
    expect(srv.sessionIds()).toHaveLength(1);
    expect(srv.log.some((r) => r.httpMethod === "DELETE")).toBe(false);
    broker.respond(pending.id, { action: "accept", content: { city: "Rome" } });
    // Even after respond() clears the pending elicitation, slow_weather still runs for ~80ms (> 30ms idleMs)
    expect(jsonOf(await call)).toEqual({ action: "accept", content: { city: "Rome", units: "metric" } });
    await waitFor(() => srv!.sessionIds().length === 0);
  });

  it("cancels pending elicitations when the session is released", async () => {
    srv = await startSessionServer({ configure: configureLegacy });
    const broker = createElicitationBroker();
    pool = createSessionPool({ elicitations: broker });
    const s = await pool.acquire(srv.url);
    const call = s.client.callTool({ name: "weather", arguments: {} }).then(
      (r) => ({ ok: true as const, r }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    await waitFor(() => broker.hasPending(srv!.url));
    await pool.release(srv.url, true);
    expect(broker.list().pending).toEqual([]);
    const outcome = await call;
    expect(outcome.ok).toBe(false);
  });

  it("cancels the first server-initiated elicitation (request id 0) when the server aborts it", async () => {
    const serverAbort = new AbortController();
    srv = await startSessionServer({
      configure(mcp) {
        mcp.registerTool("cancel_first", { description: "cancels first elicitation" }, async (extra) => {
          try {
            await mcp.server.elicitInput(
              { mode: "form", message: "First request", requestedSchema: legacySchema },
              { relatedRequestId: extra.requestId, signal: serverAbort.signal },
            );
            return { content: [{ type: "text", text: "unexpected" }] };
          } catch {
            return { content: [{ type: "text", text: "cancelled" }] };
          }
        });
      },
    });
    const broker = createElicitationBroker();
    pool = createSessionPool({ elicitations: broker });
    const s = await pool.acquire(srv.url);
    const call = s.client.callTool({ name: "cancel_first", arguments: {} });
    await waitFor(() => broker.hasPending(srv!.url));
    serverAbort.abort(new Error("server cancelled"));
    await waitFor(() => !broker.hasPending(srv!.url));
    expect(broker.list(srv.url).pending).toEqual([]);
    expect(textOf(await call)).toBe("cancelled");
  });
});

describe("elicitations router", () => {
  function context(elicitations?: ElicitationBroker): TRPCContext {
    return {
      sessions: { acquire: async () => { throw new Error("unused"); }, release: async () => {} },
      pendingAuthUrls: new Map(),
      configOpts: {},
      ...(elicitations ? { elicitations } : {}),
    };
  }

  it("fails with PRECONDITION_FAILED without a broker", async () => {
    const caller = createCaller(context());
    await expect(caller.elicitations.pending()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(caller.elicitations.respond({ id: "x", action: "cancel" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("lists pending elicitations filtered by server and rejects unknown ids", async () => {
    const broker = createElicitationBroker();
    const caller = createCaller(context(broker));
    const a = broker.request("a", formParams("for a"));
    void broker.request("b", formParams("for b")).catch(() => {});
    broker.recordCompletion("a", "done-1");
    const listed = await caller.elicitations.pending({ serverName: "a" });
    expect(listed.pending.map((p) => p.params.message)).toEqual(["for a"]);
    expect(listed.completions.map((c) => c.elicitationId)).toEqual(["done-1"]);
    expect((await caller.elicitations.pending()).pending).toHaveLength(2);

    await expect(caller.elicitations.respond({ id: "missing", action: "cancel" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const id = listed.pending[0]!.id;
    await caller.elicitations.respond({ id, action: "cancel", content: { name: "x" } });
    await expect(a).resolves.toEqual({ action: "cancel" });
    broker.cancelAll();
  });
});

describe("declarative test runner elicitation", () => {
  let server: Awaited<ReturnType<typeof startStatelessServer>> | undefined;
  let srv: SessionTestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    await srv?.close();
    srv = undefined;
  });

  it("answers form elicitations from elicit: steps and exposes them to expect/capture", async () => {
    server = await startStatelessServer({ configure: configureModern });
    const report = await runSuites(
      [
        {
          source: "inline",
          suite: {
            target: server.url,
            vars: { who: "Linus" },
            cases: [
              {
                name: "greets",
                steps: [
                  {
                    call: "greet",
                    elicit: [{ action: "accept", content: { name: "${who}" } }],
                    expect: {
                      "elicitations.0.mode": "form",
                      "elicitations.0.message": "Who are you?",
                      "elicitations.0.requestedSchema.required.0": "name",
                      text: { contains: "Linus" },
                    },
                    capture: { asked: "elicitations.0.message" },
                  },
                  {
                    call: "wizard",
                    elicit: [
                      { action: "accept", content: { first: "${asked}" } },
                      { action: "accept", content: { second: 5 } },
                    ],
                    expect: {
                      "elicitations.1.message": "Round 2",
                      text: { contains: "round-2:Who are you?" },
                    },
                  },
                  { call: "greet", elicit: [{ action: "decline" }], expect: { text: { contains: "decline" } } },
                ],
              },
            ],
          },
        },
      ],
      { connectOptions: { quiet: true } },
    );
    expect(report.cases[0]?.steps.map((s) => [s.action, s.ok, s.error, s.assertions.filter((a) => !a.ok)])).toEqual([
      ["call greet", true, undefined, []],
      ["call wizard", true, undefined, []],
      ["call greet", true, undefined, []],
    ]);
    expect(report.ok).toBe(true);
  });

  it("answers URL elicitations and fails clearly when no scripted response is left", async () => {
    server = await startStatelessServer({ configure: configureModern });
    const report = await runSuites(
      [
        {
          source: "inline",
          suite: {
            target: server.url,
            cases: [
              {
                name: "url",
                steps: [
                  {
                    call: "authorize",
                    elicit: [{ action: "accept" }],
                    expect: {
                      "elicitations.0.mode": "url",
                      "elicitations.0.url": "https://auth.example.test/start",
                      text: { contains: "accept" },
                    },
                  },
                ],
              },
              { name: "unscripted", steps: [{ call: "greet" }] },
              { name: "no elicitations", steps: [{ call: "echo", with: { text: "hi" }, expect: { elicitations: { exists: false } } }] },
            ],
          },
        },
      ],
      { connectOptions: { quiet: true } },
    );
    expect(report.cases[0]?.ok).toBe(true);
    expect(report.cases[1]?.ok).toBe(false);
    expect(report.cases[1]?.steps[0]?.error).toMatch(/no scripted `elicit` response left/);
    expect(report.cases[2]?.ok).toBe(true);
  });

  it("answers legacy elicitations and does not advertise elicitation without elicit: steps", async () => {
    srv = await startSessionServer({ configure: configureLegacy });
    const report = await runSuites(
      [
        {
          source: "inline",
          suite: {
            target: srv.url,
            cases: [
              {
                name: "legacy",
                steps: [
                  {
                    call: "weather",
                    elicit: [{ action: "accept", content: { city: "Lima" } }],
                    expect: { "elicitations.0.message": "Which city?", text: { contains: "Lima" } },
                  },
                ],
              },
            ],
          },
        },
      ],
      { connectOptions: { quiet: true } },
    );
    expect(report.ok).toBe(true);

    const plain = await runSuites(
      [
        {
          source: "inline",
          suite: {
            target: srv.url,
            cases: [
              {
                name: "plain",
                steps: [{ call: "weather", expect: { isError: true, text: { matches: "does not support .*elicitation" } } }],
              },
            ],
          },
        },
      ],
      { connectOptions: { quiet: true } },
    );
    expect(plain.cases[0]?.steps[0]?.assertions.filter((a) => !a.ok)).toEqual([]);
    expect(plain.ok).toBe(true);
  });
});
