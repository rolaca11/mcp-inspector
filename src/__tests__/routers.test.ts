import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCallerFactory } from "../trpc/trpc.js";
import type { TRPCContext, SessionPool } from "../trpc/trpc.js";
import { appRouter } from "../trpc/router.js";
import type { Session } from "../client.js";

const createCaller = createCallerFactory(appRouter);

function createMockClient() {
  return {
    getServerCapabilities: () => ({
      resources: {},
      tools: {},
      prompts: {},
    }),
    getServerVersion: () => ({ name: "test-server", version: "1.0.0" }),
    getInstructions: () => null,
    listResources: async () => ({
      resources: [{ uri: "test://r1", name: "resource-1" }],
    }),
    listResourceTemplates: async () => ({ resourceTemplates: [] }),
    readResource: async ({ uri }: { uri: string }) => ({
      contents: [{ uri, text: "test content", mimeType: "text/plain" }],
    }),
    listTools: async () => ({
      tools: [
        {
          name: "test-tool",
          description: "A test tool",
          inputSchema: { type: "object" as const },
        },
      ],
    }),
    callTool: async ({
      name,
    }: {
      name: string;
      arguments?: Record<string, unknown>;
    }) => ({
      content: [{ type: "text" as const, text: `called ${name}` }],
    }),
    listPrompts: async () => ({
      prompts: [{ name: "test-prompt", description: "A test prompt" }],
    }),
    getPrompt: async ({ name }: { name: string }) => ({
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: `prompt: ${name}` },
        },
      ],
    }),
    complete: async () => ({
      completion: { values: ["alpha", "beta"], total: 2 },
    }),
    close: async () => {},
  };
}

function createMockSession(): Session {
  return {
    client: createMockClient() as unknown as Session["client"],
    target: {
      kind: "stdio" as const,
      command: "test",
      args: [] as string[],
      raw: "test",
    },
    id: "test",
    close: async () => {},
  };
}

function createMockSessionPool(session?: Session): SessionPool {
  const s = session ?? createMockSession();
  return {
    acquire: async () => s,
    release: async () => {},
  };
}

function createContext(overrides: Partial<TRPCContext> = {}): TRPCContext {
  return {
    sessions: createMockSessionPool(),
    pendingAuthUrls: new Map(),
    configOpts: {},
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Health router                                                       */
/* ------------------------------------------------------------------ */

describe("health router", () => {
  it("check returns { ok: true }", async () => {
    const caller = createCaller(createContext());
    const result = await caller.health.check();
    expect(result).toEqual({ ok: true });
  });
});

/* ------------------------------------------------------------------ */
/* Config router                                                       */
/* ------------------------------------------------------------------ */

describe("config router", () => {
  let tmpDir: string;
  let originalXDG: string | undefined;

  beforeEach(() => {
    originalXDG = process.env.XDG_CONFIG_HOME;
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mcp-config-router-test-"),
    );
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  afterEach(() => {
    if (originalXDG === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXDG;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("list returns empty servers when no config file exists", async () => {
    const caller = createCaller(createContext());
    const result = await caller.config.list();
    expect(result.servers).toEqual({});
    expect(result.path).toContain("mcp.json");
  });

  it("add creates a server entry", async () => {
    const caller = createCaller(createContext());
    const addResult = await caller.config.add({
      name: "test-server",
      config: { command: "echo", args: ["hello"] },
    });
    expect(addResult.ok).toBe(true);
    expect(addResult.name).toBe("test-server");

    const listResult = await caller.config.list();
    expect(listResult.servers).toHaveProperty("test-server");
  });

  it("add rejects duplicate without force", async () => {
    const caller = createCaller(createContext());
    await caller.config.add({
      name: "test-server",
      config: { command: "echo" },
    });
    await expect(
      caller.config.add({
        name: "test-server",
        config: { command: "echo2" },
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("add allows overwrite with force", async () => {
    const caller = createCaller(createContext());
    await caller.config.add({
      name: "test-server",
      config: { command: "echo" },
    });
    await caller.config.add({
      name: "test-server",
      config: { command: "echo2" },
      force: true,
    });
    const result = await caller.config.list();
    expect(
      (result.servers["test-server"] as { command: string }).command,
    ).toBe("echo2");
  });

  it("add supports HTTP config", async () => {
    const caller = createCaller(createContext());
    await caller.config.add({
      name: "remote",
      config: { url: "https://example.com/mcp" },
    });
    const result = await caller.config.list();
    expect(
      (result.servers["remote"] as { url: string }).url,
    ).toBe("https://example.com/mcp");
  });

  it("remove deletes a server entry", async () => {
    const caller = createCaller(createContext());
    await caller.config.add({
      name: "test-server",
      config: { command: "echo" },
    });
    const removeResult = await caller.config.remove({ name: "test-server" });
    expect(removeResult.ok).toBe(true);

    const listResult = await caller.config.list();
    expect(listResult.servers).not.toHaveProperty("test-server");
  });

  it("remove throws for non-existent server", async () => {
    const caller = createCaller(createContext());
    await expect(
      caller.config.remove({ name: "nonexistent" }),
    ).rejects.toThrow(/not found/);
  });
});

/* ------------------------------------------------------------------ */
/* Servers router                                                      */
/* ------------------------------------------------------------------ */

describe("servers router", () => {
  let tmpDir: string;
  let originalXDG: string | undefined;

  beforeEach(() => {
    originalXDG = process.env.XDG_CONFIG_HOME;
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mcp-servers-router-test-"),
    );
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  afterEach(() => {
    if (originalXDG === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXDG;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("list returns server summary structure", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.list();
    expect(result).toHaveProperty("sources");
    expect(result).toHaveProperty("servers");
    expect(result).toHaveProperty("errors");
    expect(Array.isArray(result.servers)).toBe(true);
  });

  it("listTools returns tools from mock session", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.listTools({
      serverName: "http://test.example.com",
    });
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]!.name).toBe("test-tool");
  });

  it("listResources returns resources from mock session", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.listResources({
      serverName: "http://test.example.com",
    });
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]!.uri).toBe("test://r1");
  });

  it("listResourceTemplates returns templates", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.listResourceTemplates({
      serverName: "http://test.example.com",
    });
    expect(result.resourceTemplates).toHaveLength(0);
  });

  it("readResource returns activity entries", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.readResource({
      serverName: "http://test.example.com",
      items: { uri: "test://doc" },
    });
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]!.outcome).toBe("ok");
    expect(result.activities[0]!.kind).toBe("resource-read");
  });

  it("readResource handles batch items", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.readResource({
      serverName: "http://test.example.com",
      items: [{ uri: "test://a" }, { uri: "test://b" }],
    });
    expect(result.activities).toHaveLength(2);
  });

  it("callTool returns activity entries", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.callTool({
      serverName: "http://test.example.com",
      items: { name: "test-tool", arguments: { key: "value" } },
    });
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]!.outcome).toBe("ok");
    expect(result.activities[0]!.kind).toBe("tool-call");
  });

  it("callTool handles batch items", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.callTool({
      serverName: "http://test.example.com",
      items: [{ name: "tool-a" }, { name: "tool-b" }],
    });
    expect(result.activities).toHaveLength(2);
  });

  it("listPrompts returns prompts from mock session", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.listPrompts({
      serverName: "http://test.example.com",
    });
    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]!.name).toBe("test-prompt");
  });

  it("getPrompt returns activity entries", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.getPrompt({
      serverName: "http://test.example.com",
      items: { name: "test-prompt", arguments: { lang: "en" } },
    });
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]!.outcome).toBe("ok");
    expect(result.activities[0]!.kind).toBe("prompt-get");
  });

  it("getPrompt handles batch items", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.getPrompt({
      serverName: "http://test.example.com",
      items: [{ name: "p1" }, { name: "p2" }],
    });
    expect(result.activities).toHaveLength(2);
  });

  it("complete returns activity entries", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.complete({
      serverName: "http://test.example.com",
      items: {
        refType: "prompt",
        ref: "test-prompt",
        argument: "lang",
        value: "e",
      },
    });
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]!.outcome).toBe("ok");
    expect(result.activities[0]!.kind).toBe("complete");
  });

  it("complete handles batch items", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.complete({
      serverName: "http://test.example.com",
      items: [
        { refType: "prompt", ref: "p", argument: "a" },
        { refType: "resource", ref: "r://{x}", argument: "x" },
      ],
    });
    expect(result.activities).toHaveLength(2);
  });

  it("discover reconnects and returns activities", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.discover({
      serverName: "http://test.example.com",
    });
    expect(result.activities.length).toBeGreaterThanOrEqual(1);
    expect(result.activities[0]!.kind).toBe("discover");
  });

  it("authStatus returns auth info for unknown target", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.authStatus({
      serverName: "http://test.example.com",
    });
    expect(result).toHaveProperty("file");
    expect(result).toHaveProperty("exists");
    expect(result.exists).toBe(false);
  });

  it("authLogout returns activity", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.authLogout({
      serverName: "http://test.example.com",
    });
    expect(result.activities).toHaveLength(1);
  });

  it("authUrl returns null when no pending auth", async () => {
    const caller = createCaller(createContext());
    const result = await caller.servers.authUrl({
      serverName: "http://test.example.com",
    });
    expect(result.url).toBeNull();
  });

  it("authUrl returns and clears pending URL", async () => {
    const pendingAuthUrls = new Map<string, string>();
    pendingAuthUrls.set(
      "http://test.example.com",
      "https://auth.example.com/authorize",
    );
    const caller = createCaller(createContext({ pendingAuthUrls }));
    const result = await caller.servers.authUrl({
      serverName: "http://test.example.com",
    });
    expect(result.url).toBe("https://auth.example.com/authorize");
    expect(pendingAuthUrls.has("http://test.example.com")).toBe(false);
  });

  it("disconnect releases session and returns activity", async () => {
    let released = false;
    const pool: SessionPool = {
      acquire: async () => createMockSession(),
      release: async () => {
        released = true;
      },
    };
    const caller = createCaller(createContext({ sessions: pool }));
    const result = await caller.servers.disconnect({
      serverName: "http://test.example.com",
    });
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]!.outcome).toBe("ok");
    expect(released).toBe(true);
  });

  it("rejects unknown non-URL server name", async () => {
    const caller = createCaller(createContext());
    await expect(
      caller.servers.listTools({ serverName: "unknown-server" }),
    ).rejects.toThrow(/unknown server/);
  });
});
