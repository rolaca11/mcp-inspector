/**
 * Real streamable-HTTP MCP server for session tests: assigns a session ID on
 * `initialize`, routes follow-up requests by `Mcp-Session-Id`, rejects unknown
 * sessions (404, like a restarted server would), and records every HTTP
 * request it sees.
 */

import http from "node:http";
import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const NAMES = ["Ada", "Alan", "Grace"];

export interface LoggedRequest {
  httpMethod: string;
  /** JSON-RPC method(s) in the body, or "(none)" for GET/DELETE. */
  rpc: string;
  sessionId: string | null;
  status: number;
}

export interface SessionTestServer {
  url: string;
  log: LoggedRequest[];
  /** Session IDs currently known to the server. */
  sessionIds(): string[];
  /** Forget all sessions, as if the server had restarted. */
  wipeSessions(): Promise<void>;
  close(): Promise<void>;
}

export async function startSessionServer(): Promise<SessionTestServer> {
  const log: LoggedRequest[] = [];
  const transports = new Map<string, StreamableHTTPServerTransport>();

  async function createSession(): Promise<StreamableHTTPServerTransport> {
    const mcp = new McpServer({ name: "session-test", version: "0.0.1" });
    // `echo` is relied on by the session-id and pool tests — keep its shape.
    mcp.registerTool(
      "echo",
      { description: "echo", inputSchema: { text: z.string() } },
      async ({ text }) => ({ content: [{ type: "text", text }] }),
    );
    // `add` exercises structured content (and the output-schema validation path).
    mcp.registerTool(
      "add",
      {
        description: "add two numbers",
        inputSchema: { a: z.number(), b: z.number() },
        outputSchema: { sum: z.number() },
      },
      async ({ a, b }) => {
        const sum = a + b;
        return {
          content: [{ type: "text", text: `sum=${sum}` }],
          structuredContent: { sum },
        };
      },
    );
    // `boom` exercises the MCP error channel (isError: true, not a thrown error).
    mcp.registerTool(
      "boom",
      { description: "always fails", inputSchema: {} },
      async () => ({ content: [{ type: "text", text: "kaboom" }], isError: true }),
    );
    mcp.registerResource(
      "greeting",
      "test://greeting",
      { title: "Greeting", mimeType: "text/plain" },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "text/plain", text: "hello world" }],
      }),
    );
    mcp.registerPrompt(
      "greet",
      {
        description: "greet someone",
        argsSchema: {
          name: completable(z.string(), (value) =>
            NAMES.filter((n) => n.toLowerCase().startsWith(value.toLowerCase())),
          ),
        },
      },
      ({ name }) => ({
        messages: [{ role: "user", content: { type: "text", text: `Hi ${name}` } }],
      }),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports.set(sid, transport);
      },
      onsessionclosed: (sid) => {
        transports.delete(sid);
      },
    });
    await mcp.connect(transport);
    return transport;
  }

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const bodyRaw = Buffer.concat(chunks).toString("utf8");

    let rpc = "(none)";
    let body: unknown;
    if (bodyRaw) {
      try {
        body = JSON.parse(bodyRaw);
        const msgs = Array.isArray(body) ? body : [body];
        rpc = msgs
          .map((m) => (m as { method?: string }).method ?? "(response)")
          .join(",");
      } catch {
        rpc = "(unparseable)";
      }
    }

    const sessionId = (req.headers["mcp-session-id"] as string) ?? null;
    res.on("finish", () => {
      log.push({
        httpMethod: req.method ?? "?",
        rpc,
        sessionId,
        status: res.statusCode,
      });
    });

    const isInit =
      req.method === "POST" &&
      (Array.isArray(body) ? body.some(isInitializeRequest) : isInitializeRequest(body));

    let transport: StreamableHTTPServerTransport | undefined;
    if (isInit && !sessionId) {
      transport = await createSession();
    } else if (sessionId) {
      transport = transports.get(sessionId);
    }

    if (!transport) {
      // Unknown or missing session — per spec, answer 404 so the client
      // starts a new session with a fresh InitializeRequest.
      res.writeHead(404, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        }),
      );
      return;
    }

    await transport.handleRequest(req, res, body);
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    url: `http://127.0.0.1:${port}/`,
    log,
    sessionIds: () => Array.from(transports.keys()),
    async wipeSessions() {
      const all = Array.from(transports.values());
      transports.clear();
      // Close without notifying clients — mimics an abrupt restart.
      await Promise.all(all.map((t) => t.close().catch(() => {})));
    },
    async close() {
      const all = Array.from(transports.values());
      transports.clear();
      await Promise.all(all.map((t) => t.close().catch(() => {})));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
