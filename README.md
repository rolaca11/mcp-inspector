# mcp-inspector

A [Model Context Protocol](https://modelcontextprotocol.io) client with three
front-ends backed by one set of primitives:

- **CLI** — `mcp-inspector <verb> <target>` for scripts and pipelines.
- **REPL** — `mcp-inspector connect <target>` for an interactive prompt.
- **Web dashboard** — `mcp-inspector serve` boots a local HTTP server that
  hosts the bundled React/Tailwind dashboard at `/` and a small JSON API at
  `/api/*`. Same process, same OAuth state, same `.mcp.json`.

Connect to MCP servers over **stdio** or **OAuth-protected Streamable HTTP**,
discover their resources / resource templates / tools / prompts, call them,
and request completions.

Built on the official [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk).

---

## Install

```sh
pnpm install      # one install — covers CLI and dashboard
pnpm build        # tsc → dist/*.js  +  vite build → dist/web/
```

`pnpm build` produces both:

- `dist/cli.js` — the binary exposed as `mcp-inspector` / `mcpi` via
  `package.json#bin`.
- `dist/web/` — the static dashboard bundle that `mcp-inspector serve` loads.

To use globally:

```sh
pnpm link --global
mcp-inspector --help
```

Or run without linking:

```sh
node dist/cli.js --help
# or during development:
pnpm dev -- --help
```

Requires Node ≥ 18.

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
                                  [--no-ui]              # JSON API only
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
mcpi> discover
mcpi> tools
mcpi> call echo {"message":"hi"}
mcpi> read demo://resource/static/document/instructions.md
mcpi> complete prompt completable-prompt department
mcpi> json on
mcpi> tools
mcpi> quit
```

Tab completion is on for verbs, tool names, prompt names, resource URIs, and
resource-template variable names (lazily populated after connect).

---

## Web dashboard

`mcp-inspector serve` boots a local HTTP server that exposes:

- `/`        — the bundled React/Tailwind dashboard (`dist/web/`)
- `/api/*`   — a small JSON API mirroring the CLI verbs in `actions.ts`

Same process, same OAuth state, same `.mcp.json`. Sessions are cached in
memory and idle-evicted after five minutes; child stdio processes are reaped
on `SIGINT`/`SIGTERM`.

```sh
mcp-inspector serve                 # http://127.0.0.1:8765, opens the browser
mcp-inspector serve -p 4000
mcp-inspector serve --no-open       # skip the browser launch
mcp-inspector serve --no-ui         # API-only (handy when developing the UI with `pnpm dev:web`)
```

API surface (every route maps to one action):

```text
GET    /api/health
GET    /api/servers
GET    /api/servers/:name/discover
GET    /api/servers/:name/resources
GET    /api/servers/:name/resources/templates
POST   /api/servers/:name/resources/read     {uri}
GET    /api/servers/:name/tools
POST   /api/servers/:name/tools/call         {name, arguments?}
GET    /api/servers/:name/prompts
POST   /api/servers/:name/prompts/get        {name, arguments?}
POST   /api/servers/:name/complete           {refType, ref, argument, value?, context?}
GET    /api/servers/:name/auth
DELETE /api/servers/:name/auth
POST   /api/servers/:name/disconnect
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
├── actions.ts        # primitive actions used by CLI, REPL, and HTTP server
├── repl.ts           # interactive readline REPL
└── server.ts         # `mcp-inspector serve` — HTTP server hosting UI + JSON API

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

CLI, REPL, and HTTP server all call `actions.ts` and share the same OAuth
state and `.mcp.json` resolution.

---

## Development

```sh
pnpm dev -- discover "npx -y @modelcontextprotocol/server-everything stdio"

# Dashboard with HMR:
pnpm dev -- serve --no-open --no-ui   # API on :8765 in one terminal
pnpm dev:web                          # Vite dev server with /api proxy in another

pnpm typecheck                        # tsc + tsc -p web/tsconfig.app.json
pnpm build                            # tsc → dist/*.js  +  vite → dist/web/
```
