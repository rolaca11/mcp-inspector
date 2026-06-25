import { defineMcpTest } from "./packages/core/src/testing/fixtures.js";

// This is what the README shows
const test1 = defineMcpTest({
  scope: "test",
  target: "stub",
  connect: async () => ({
    id: "stub",
    target: { kind: "stdio" as const, command: "x", args: [], raw: "stub" },
    client: { callTool: async () => ({ content: [{ type: "text", text: "stubbed" }] }) } as never,
    close: async () => {},
  }),
});
