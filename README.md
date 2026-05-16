# @rolaca11/mcp-inspector

A [Model Context Protocol](https://modelcontextprotocol.io) client with three
front-ends backed by one set of primitives:

- **CLI** — `mcp-inspector <verb> <target>` for scripts and pipelines.
- **REPL** — `mcp-inspector connect <target>` for an interactive prompt.
- **Web dashboard** — `mcp-inspector serve` boots a local HTTP server that
  hosts the bundled React/Tailwind dashboard at `/` and the tRPC API at
  `/api/trpc`. Same process, same OAuth state, same `.mcp.json`.

Connect to MCP servers over **stdio** or **OAuth-protected Streamable HTTP**,
discover their resources / resource templates / tools / prompts, call them,
and request completions.

Built on the official [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk).

---

## Install

### From npm (recommended)

```sh
npm install -g @rolaca11/mcp-inspector
```

Or with pnpm:

```sh
pnpm add -g @rolaca11/mcp-inspector
```

This gives you the `mcp-inspector` command globally.

### One-off usage with npx

```sh
npx @rolaca11/mcp-inspector --help
npx @rolaca11/mcp-inspector discover everything
```

### From source

```sh
git clone https://github.com/rolaca11/mcp-inspector.git
cd mcp-inspector
bun install       # one install - covers CLI and dashboard
bun run build     # CLI bundle + Vite dashboard bundle
```

`bun run build` produces both:

- `dist/cli.js` — the binary exposed as `mcp-inspector` via
  `package.json#bin`.
- `dist/web/` — the static dashboard bundle that `mcp-inspector serve` loads.

To use globally from source:

```sh
bun link
mcp-inspector --help
```

Or run without linking:

```sh
node dist/cli.js --help
# or during development:
bun run dev:cli -- --help
```

Requires Bun >= 1.2.0 for development scripts.

---

## Targets

Every command takes a single positional `<target>` argument that points at an
MCP server. Three forms are supported, resolved in this order:

| Form          | Example                                                           | Transport          |
|---------------|-------------------------------------------------------------------|--------------------|
| Named server  | `everything` (looked up in `.mcp.json`)                           | inherited from config |
| HTTP URL      | `https://example.com/mcp`                                         | Streamable HTTP    |
| Stdio command | `"npx -y @modelcontextprotocol/server-everything stdio"`          | Stdio (child proc) |

Stdio commands need to be quoted so the shell delivers them as one argument;
they are then split with `shell-quote`. URLs are auto-detected by their
`http(s)://` prefix.

### `.mcp.json` named servers

On every run, `mcp-inspector` reads two files in this precedence order
(later overrides earlier):

1. `~/.mcp.json`        — user-global
2. `<cwd>/.mcp.json`    — project-local

The format follows the de-facto convention used by Claude Desktop / Claude
Code:

```json
{
  "mcpServers": {
    "everything": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything", "stdio"],
      "env": { "DEBUG": "1" }
    },
    "remote": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": { "X-Foo": "bar" }
    }
  }
}
```

For stdio entries, `env` is merged on top of the parent process's environment
and `cwd` (optional) sets the child's working directory.
For HTTP entries, `headers` are forwarded on every request.

Named-server lookup wins over URL/stdio interpretation, so the alias takes
priority even if the same string would also be a valid URL.

`mcp-inspector servers` prints what was loaded:

```
$ mcp-inspector servers
Loaded files (in precedence order, last wins):
  /home/me/.mcp.json (1 server)
  /current/dir/.mcp.json (2 servers)

Named servers (3):
  everything  npx -y @modelcontextprotocol/server-everything stdio  [stdio]
              from /current/dir/.mcp.json
  remote      https://example.com/mcp                                [http]
              from /current/dir/.mcp.json
  legacy      npx legacy-mcp-server                                  [stdio]
              from /home/me/.mcp.json
```

Errors in the JSON or per-server validation are printed as warnings on stderr
at the start of every run; bad entries are skipped, the rest still loads. Set
`MCPI_QUIET_CONFIG=1` to suppress those warnings.

---

## Commands

```text
mcp-inspector servers                                    # list named servers from .mcp.json files
mcp-inspector connect   <target>                         # interactive REPL
mcp-inspector discover  <target>                         # everything in one shot

mcp-inspector resources list      <target>
mcp-inspector resources templates <target>
mcp-inspector resources read      <target> <uri>

mcp-inspector tools list          <target>
mcp-inspector tools call          <target> <name> --args '<json>'

mcp-inspector prompts list        <target>
mcp-inspector prompts get         <target> <name> --args '<json>'

mcp-inspector complete            <target> --ref-type <prompt|resource> \
                                           --ref     <name|uri-template> \
                                           --arg     <name> \
                                           [--value  <partial>] \
                                           [--context '<json>']

mcp-inspector auth login          <target>               # force OAuth flow now
mcp-inspector auth status         <target>
mcp-inspector auth logout         <target>

mcp-inspector serve               [--port 8765]          # web dashboard at http://127.0.0.1:8765
                                  [--host 127.0.0.1]
                                  [--no-open]            # don't open the browser
                                  [--no-ui]              # tRPC API only
```

Global flags (available on every leaf command):

| Flag                  | Meaning                                                                  |
|-----------------------|--------------------------------------------------------------------------|
| `--json`              | Emit raw JSON instead of pretty output. Pipe-friendly.                   |
| `-q, --quiet`         | Suppress informational logs (e.g. OAuth flow messages).                  |
| `--scope <scope>`     | OAuth scope string to request (HTTP servers only).                       |
| `--client-name <name>`| Client name advertised during dynamic client registration.               |

`MCPI_DEBUG=1` prints the full stack on errors instead of the short message.

---

## Examples

```sh
# Discover everything against a named server defined in .mcp.json
mcp-inspector discover everything

# Same thing with the literal stdio command
mcp-inspector discover "npx -y @modelcontextprotocol/server-everything stdio"

# Call a tool with arguments
mcp-inspector tools call "npx -y @modelcontextprotocol/server-everything stdio" \
  echo --args '{"message":"hello"}'

# Read a static resource
mcp-inspector resources read "npx -y @modelcontextprotocol/server-everything stdio" \
  "demo://resource/static/document/instructions.md"

# Completion for a prompt argument
mcp-inspector complete "npx -y @modelcontextprotocol/server-everything stdio" \
  --ref-type prompt --ref completable-prompt --arg department

# Cascading completion: complete `name` given `department=Marketing`
mcp-inspector complete "npx -y @modelcontextprotocol/server-everything stdio" \
  --ref-type prompt --ref completable-prompt --arg name \
  --context '{"department":"Marketing"}'

# Completion for a resource-template variable
mcp-inspector complete https://example.com/mcp \
  --ref-type resource --ref "github://repo/{owner}/{name}" --arg owner --value "ant"

# Connect to an OAuth-protected HTTP server (browser opens for first call)
mcp-inspector connect https://example.com/mcp
```

---

## OAuth flow

For HTTP targets, the SDK's `StreamableHTTPClientTransport` drives OAuth 2.1
with PKCE. `mcp-inspector` plugs in a file-backed `OAuthClientProvider` and
runs a transient loopback HTTP server to receive the redirect:

1. **First connect**: read tokens from disk. If present and valid → connect.
2. **No tokens**: bind a loopback server on `127.0.0.1` (random port).
3. Run dynamic client registration with the loopback URL as the redirect URI.
4. The transport calls `redirectToAuthorization(url)` → we open it with
   [`open`](https://www.npmjs.com/package/open).
5. The user authorizes; the auth server redirects to
   `http://127.0.0.1:<port>/callback?code=…`.
6. The CLI consumes the `code`, calls `transport.finishAuth(code)` (which
   exchanges the code for tokens via PKCE), then retries the connection.
7. On every subsequent run, valid tokens (or refresh tokens) are reused
   silently — no browser pop-up.

Tokens, registered client information, and PKCE verifiers are stored at:

```
$XDG_CONFIG_HOME/mcp-inspector/auth/<target-id>.json
# (defaults to ~/.config/mcp-inspector/auth/<target-id>.json)
```

The file is created with mode `0600`. `mcp-inspector auth logout <target>`
deletes it; `mcp-inspector auth status <target>` prints what's stored.

The redirect URI uses the literal loopback IP (`127.0.0.1`) rather than
`localhost`, per RFC 8252 §7.3 / OAuth 2.1.

---

## Interactive REPL

`mcp-inspector connect <target>` opens an interactive prompt with the same
verbs as the CLI:

```text
mcp-inspector> discover
mcp-inspector> tools
mcp-inspector> call echo {"message":"hi"}
mcp-inspector> read demo://resource/static/document/instructions.md
mcp-inspector> complete prompt completable-prompt department
mcp-inspector> json on
mcp-inspector> tools
mcp-inspector> quit
```

Tab completion is on for verbs, tool names, prompt names, resource URIs, and
resource-template variable names (lazily populated after connect).

---

## Web dashboard

`mcp-inspector serve` boots a local HTTP server that exposes:

- `/`         — the bundled React/Tailwind dashboard (`dist/web/`)
- `/api/trpc` — the tRPC API used by the dashboard

Same process, same OAuth state, same `.mcp.json`. Sessions are cached in
memory and idle-evicted after five minutes; child stdio processes are reaped
on `SIGINT`/`SIGTERM`.

```sh
mcp-inspector serve                 # http://127.0.0.1:8765, opens the browser
mcp-inspector serve -p 4000
mcp-inspector serve --no-open       # skip the browser launch
mcp-inspector serve --no-ui         # API-only (handy when developing the UI with `bun run dev:ui`)
```

API surface (procedures under `/api/trpc`):

```text
health.check
servers.list
servers.discover
servers.listResources
servers.listResourceTemplates
servers.readResource
servers.listTools
servers.callTool
servers.listPrompts
servers.getPrompt
servers.complete
servers.authStatus
servers.authLogout
servers.authUrl
servers.disconnect
config.list
config.add
config.remove
```

`:name` accepts either an alias from `.mcp.json` or a raw target (HTTP URL,
or a quoted stdio command).

---

## Project layout

```
src/                  # CLI + REPL + web server (same TypeScript build)
├── cli.ts            # commander entry point — wires every subcommand
├── client.ts         # connect() — picks transport, runs OAuth flow with retry
├── oauth.ts          # FileOAuthProvider + loopback callback server
├── config.ts         # .mcp.json loader (cwd + home, with merging)
├── paths.ts          # OAuth config-dir helpers
├── target.ts         # parse "target" string into transport spec
├── format.ts         # pretty-printers (resources, tools, prompts, …)
├── actions.ts        # primitive actions used by CLI and REPL
├── repl.ts           # interactive readline REPL
└── server.ts         # `mcp-inspector serve` - HTTP server hosting UI + tRPC API

web/                  # dashboard source (React 19 · Tailwind v4 · shadcn)
├── index.html
├── public/
└── src/
    ├── App.tsx
    ├── components/   # header, nav-tabs, status-dot, code-block, ui/* …
    ├── pages/        # overview, resources, tools, prompts, completions, auth, servers
    ├── data/         # api client + types + fixture fallback
    └── hooks/

tsconfig.json         # CLI build (tsc → dist/*.js)
vite.config.ts        # UI build (vite → dist/web/)
```

CLI and REPL call `actions.ts`; the dashboard server exposes equivalent tRPC
procedures. All three share the same OAuth state and `.mcp.json` resolution.

---

## Development

```sh
bun run dev:cli -- discover "npx -y @modelcontextprotocol/server-everything stdio"

# Dashboard with HMR:
bun run dev:cli -- serve --no-open --no-ui   # API on :8765 in one terminal
bun run dev:ui                                # Vite dev server with /api/trpc proxy in another

bun run typecheck
bun run build
```
