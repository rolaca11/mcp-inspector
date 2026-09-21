import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { McpServer as LegacyServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

function register(server) {
  server.registerTool("echo", {}, async () => ({
    content: [{ type: "text", text: process.env.INSPECTOR_TEST_VALUE ?? "echo" }],
  }));
  return server;
}

if (process.argv[2] === "legacy") {
  await register(new LegacyServer({ name: "stdio-legacy", version: "1.0.0" }))
    .connect(new StdioServerTransport());
} else {
  serveStdio(() => register(new McpServer({ name: "stdio-modern", version: "1.0.0" })));
}
