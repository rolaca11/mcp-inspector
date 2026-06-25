/**
 * Public entry point for the vitest-based MCP testing primitives
 * (`@rolaca11/mcp-inspector-vitest`).
 *
 * Write test cases in TypeScript and run them with vitest:
 *
 *   import { describe, expect } from "vitest";
 *   import { defineMcpTest } from "@rolaca11/mcp-inspector-vitest";
 *
 *   const test = defineMcpTest({ target: "everything" });
 *   describe("everything", () => {
 *     test("echoes", async ({ mcp }) => {
 *       expect(await mcp.callTool("echo", { message: "hi" })).toHaveText("hi");
 *     });
 *   });
 *
 * Importing from here brings the custom-matcher type augmentation into scope;
 * register the matchers at runtime via the
 * `@rolaca11/mcp-inspector-vitest/setup` setupFiles entry (or call
 * `installMcpMatchers()` yourself).
 */

import type { McpMatchers } from "./matchers.js";

export {
  wrap,
  toolResult,
  resourceResult,
  promptResult,
  completionResult,
} from "./wrap.js";
export type {
  McpClient,
  Probed,
  ToolResult,
  ResourceResult,
  PromptResult,
  ListResult,
  CompletionResult,
} from "./wrap.js";

export { defineMcpTest } from "./fixtures.js";
export type {
  McpFixtures,
  McpTarget,
  DefineMcpTestOptions,
} from "./fixtures.js";

export { installMcpMatchers } from "./matchers.js";
export type { McpMatchers, ResourceExpectation } from "./matchers.js";

export { joinText, listNames, coerceIsError } from "./normalize.js";

// Teach vitest's `expect` about the MCP matchers. Kept here (not in the
// side-effecting setup module) so the augmentation loads as soon as anything is
// imported from this entry, decoupled from the runtime install path. Both
// interfaces extend `McpMatchers` with the SAME (default) return type so the
// members stay identical — `ExpectStatic` extends both, and differing
// signatures would make it fail to merge.
declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Matchers<T = any> extends McpMatchers {}
  interface AsymmetricMatchersContaining extends McpMatchers {}
}
