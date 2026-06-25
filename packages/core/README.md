# @rolaca11/mcp-inspector-core

Core library behind [`@rolaca11/mcp-inspector`](https://www.npmjs.com/package/@rolaca11/mcp-inspector)
(the CLI + dashboard) and [`@rolaca11/mcp-inspector-vitest`](https://www.npmjs.com/package/@rolaca11/mcp-inspector-vitest)
(the testing primitives).

It connects to [MCP](https://modelcontextprotocol.io) servers over stdio or
OAuth-protected Streamable HTTP and exposes the building blocks the higher-level
packages share.

## Exports

| Subpath | What it provides |
|---------|------------------|
| `./client` | `connect(target, opts?)` → a `Session` (picks transport, runs the OAuth flow with retry) |
| `./session-pool` | `createSessionPool()` — pooled, self-healing sessions keyed by target |
| `./target` | `parseTarget()` / `targetId()` — resolve a target string (named server, URL, or stdio command) |
| `./config` · `./config-files` | `.mcp.json` discovery and merging (cwd + home) |
| `./actions` | one-shot tool / resource / prompt / completion actions over a session |
| `./oauth` · `./paths` | file-backed `OAuthClientProvider` + loopback callback, config-dir helpers |
| `./format` · `./tokens` · `./apps` · `./version` | pretty-printers, token counting, MCP Apps detection, version |

```ts
import { connect } from "@rolaca11/mcp-inspector-core/client";

const session = await connect("npx -y @modelcontextprotocol/server-everything stdio");
const tools = await session.client.listTools();
await session.close();
```

To write tests against MCP servers, use
[`@rolaca11/mcp-inspector-vitest`](https://www.npmjs.com/package/@rolaca11/mcp-inspector-vitest),
which builds on this package.

## License

MIT
