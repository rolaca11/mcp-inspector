# @rolaca11/mcp-inspector-vitest

Vitest primitives and matchers for testing [MCP](https://modelcontextprotocol.io)
servers. Write test cases in TypeScript and run them with
[Vitest](https://vitest.dev): a fixture owns the session lifecycle, a typed
client returns ergonomic result objects, and MCP-aware `expect` matchers give
readable failures.

Built on [`@rolaca11/mcp-inspector-core`](https://www.npmjs.com/package/@rolaca11/mcp-inspector-core)
(connection, OAuth, `.mcp.json` resolution).

## Install

```sh
npm i -D vitest @rolaca11/mcp-inspector-vitest
```

`@rolaca11/mcp-inspector-core` comes along as a dependency; `vitest` is a peer.

Register the matchers once via `setupFiles`:

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { setupFiles: ["@rolaca11/mcp-inspector-vitest/setup"] },
});
```

(Or call `installMcpMatchers()` at the top of a test file. The matcher *types*
light up as soon as you import anything from `@rolaca11/mcp-inspector-vitest`.)

## Write a test

`defineMcpTest()` returns a vitest `test` with two fixtures: `mcp` (a connected,
wrapped client) and `mcpSession` (the raw session). It connects on the first
test that uses `mcp` and tears the session down when the suite ends.

```ts
import { describe, expect } from "vitest";
import { defineMcpTest } from "@rolaca11/mcp-inspector-vitest";

// target: an http(s) URL, a quoted stdio command, or a named server from .mcp.json
const test = defineMcpTest({
  target: "npx -y @modelcontextprotocol/server-everything stdio",
});

describe("everything server", () => {
  test("advertises its tools", async ({ mcp }) => {
    expect(await mcp.listTools()).toListName("echo", "add");
  });

  test("echoes input back", async ({ mcp }) => {
    const res = await mcp.callTool("echo", { message: "hello world" });
    expect(res).toBeOk();
    expect(res).toHaveText(/hello/);
    expect(res).toHaveContentType("text");
    expect(res.block("text")?.text).toContain("hello"); // typed, narrowed accessor
  });

  test("returns structured content", async ({ mcp }) => {
    const res = await mcp.callTool("add", { a: 2, b: 3 });
    expect(res).toHaveStructured(expect.objectContaining({ sum: 5 }));
    expect(res.json<{ sum: number }>().sum).toBe(5);
  });

  test("surfaces tool errors", async ({ mcp }) => {
    expect(await mcp.callTool("add", { a: "nope", b: 3 })).toBeMcpError(/expected number/i);
  });
});
```

## The client (`mcp`)

Each method makes one MCP call and returns a result with ergonomic accessors
over the untouched SDK result (`.raw`):

| Method | Result accessors |
|--------|------------------|
| `callTool(name, args?)` | `.isError` · `.text` · `.content` · `.structuredContent` · `.block(type)` · `.json<T>()` |
| `readResource(uri)` | `.text` · `.contents` · `.mimeType` · `.blob` · `.json<T>()` |
| `getPrompt(name, args?)` | `.text` · `.messages` · `.roles` |
| `listTools()` / `listResources()` / `listResourceTemplates()` / `listPrompts()` | `.names` |
| `complete(params)` | `.values` · `.total` · `.hasMore` |
| `ping()` | — |

`mcp.client` (the raw SDK `Client`) and `mcp.session` are exposed for anything
the façade doesn't wrap. `wrap(session)` builds the same client outside the
fixture.

## Matchers

| Matcher | Asserts |
|---------|---------|
| `toBeOk()` | tool result with `isError === false` |
| `toBeMcpError(substr? \| regex?)` | `isError === true`, optionally its text contains / matches |
| `toHaveText(substr \| regex)` | joined result text contains / matches |
| `toHaveContentType(type)` | a `text\|image\|audio\|resource\|resource_link` block is present |
| `toHaveStructured(expected)` | `structuredContent` deep-equals (works with `expect.objectContaining`) |
| `toListName(...names)` | a list result's names include every given name |
| `toMatchResource({ uri?, mimeType?, text? })` | a `readResource` result matches the given fields |

Numeric / range / one-of checks are left to plain vitest via typed accessors:
`expect(res.json<{ n: number }>().n).toBeGreaterThan(3)`.

## Unit tests without a server

`connect` is injectable, so a unit test can return a fake session — no network,
no child process. Use `scope: "test"` for a fresh session per test.

```ts
const test = defineMcpTest({
  scope: "test",
  target: "stub",
  connect: async () => ({
    id: "stub",
    target: { kind: "stdio", command: "x", args: [], raw: "stub" },
    client: { callTool: async () => ({ content: [{ type: "text", text: "stubbed" }] }) } as never,
    close: async () => {},
  }),
});

test("uses the injected connect", async ({ mcp }) => {
  expect(await mcp.callTool("anything")).toHaveText("stubbed");
});
```

## Named `.mcp.json` targets

A bare test process doesn't auto-load `.mcp.json`, so `target: "everything"`
won't resolve to an alias unless you register the config first — e.g. in a
setup file:

```ts
import { installMcpMatchers } from "@rolaca11/mcp-inspector-vitest";
import { loadConfigSync } from "@rolaca11/mcp-inspector-core/config";
import { setLoadedConfig } from "@rolaca11/mcp-inspector-core/target";

installMcpMatchers();
setLoadedConfig(loadConfigSync());
```

Otherwise use an explicit URL or quoted stdio command as the target.

## License

MIT
