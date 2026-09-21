import { createServer } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer, type JSONRPCRequest } from "@modelcontextprotocol/server";
import { z } from "zod";

export async function startStatelessServer(options: {
  responseMode?: "json" | "sse";
  failMethod?: string;
  status?: number;
  legacyOnly?: boolean;
} = {}) {
  const log: Array<{ method: string; headers: Headers; body: JSONRPCRequest }> = [];
  let instances = 0;
  const handler = createMcpHandler(() => {
    instances++;
    const server = new McpServer({ name: "stateless-test", version: "1.0.0" });
    server.registerTool("echo", {
      inputSchema: z.object({ text: z.string().meta({ "x-mcp-header": "text" }) }),
    }, async ({ text }) => ({ content: [{ type: "text", text }] }));
    server.registerResource("example", "test://example", {}, async (uri) => ({
      contents: [{ uri: uri.href, text: "example" }],
    }));
    server.registerPrompt("greet", {}, async () => ({
      messages: [{ role: "user", content: { type: "text", text: "hello" } }],
    }));
    return server;
  }, { legacy: options.legacyOnly ? "stateless" : "reject", responseMode: options.responseMode });
  const http = createServer(toNodeHandler({
    async fetch(request) {
      const body = (request.method === "POST" ? await request.clone().json() : { method: request.method }) as JSONRPCRequest;
      log.push({ method: request.method, headers: request.headers, body });
      if (options.legacyOnly && body.method === "server/discover") {
        return new Response("Not found", { status: 404 });
      }
      if (body?.method === options.failMethod) {
        return new Response("Endpoint unavailable", { status: options.status ?? 404 });
      }
      return handler.fetch(request);
    },
  }));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    log,
    instances: () => instances,
    async close() {
      await handler.close();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
