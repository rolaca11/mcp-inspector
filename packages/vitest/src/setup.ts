/**
 * Side-effecting entry for vitest's `setupFiles`. Install the MCP matchers once
 * per worker by adding this to `vitest.config.ts`:
 *
 *   test: { setupFiles: ["@rolaca11/mcp-inspector-vitest/setup"] }
 *
 * The matcher *types* come from importing anything in
 * `@rolaca11/mcp-inspector-vitest`; this module only registers them at
 * runtime. Prefer it over calling `installMcpMatchers()` per file.
 */

import { installMcpMatchers } from "./matchers.js";

installMcpMatchers();
