
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
  remote      https://example.com/mcp                               [http]
              from /current/dir/.mcp.json
  legacy      npx legacy-mcp-server                                 [stdio]
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
                                  [--config a.json b.json]
                                  [--no-open]            # don't open the browser
                                  [--no-ui]              # tRPC API only

mcp-inspector test                [paths...]             # run test suites (default: ./mcp-tests)
                                  [--target <target>]    # target for suites that omit one
                                  [--reporter console|json|junit|tap|teamcity]
                                  [--out <file>] [--bail] [--filter <substr>] [--var k=v]
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

## Testing

Codify expectations as declarative **suite files** and evaluate them with one
command — a Postman/Newman-style runner for MCP servers:

```sh
mcp-inspector test                       # run every suite in ./mcp-tests
mcp-inspector test ./suites              # a directory (scanned recursively)
mcp-inspector test smoke.yaml api.yaml   # specific files
mcp-inspector test ./suites --target everything   # target for suites that omit one
```

A suite is a YAML (`.yaml`/`.yml`) or JSON file with a `target`, optional `vars`,
and a list of `cases`. Each case has ordered `steps`; every step performs one MCP
action, optionally asserts on the result (`expect`) and binds values for later
steps (`capture`).

```yaml
target: everything          # named server | URL | quoted stdio command; --target overrides
vars:
  greeting: hello
cases:
  - name: echo round-trips text
    steps:
      - call: echo                          # tools/call
        with: { message: "${greeting}" }    # ${vars} and ${env.VAR} are interpolated
        expect:
          isError: false
          text: { contains: "hello" }       # `text` = all text blocks joined
          content.0.text: { equals: "Echo: hello" }
        capture:
          echoed: content.0.text            # -> ${echoed} in later steps
      - call: echo
        with: { message: "again: ${echoed}" }
        expect:
          content.0.text: { equals: "Echo: again: Echo: hello" }
```

### Step actions

Exactly one action key per step:

| Key                                          | MCP call               |
|----------------------------------------------|------------------------|
| `call: <tool>` + `with: {…}`                 | `tools/call`           |
| `read: <uri>`                                | `resources/read`       |
| `get: <prompt>` + `with: {…}`                | `prompts/get`          |
| `list: tools\|resources\|templates\|prompts` | the matching list call |
| `complete: { refType, ref, argument, value?, context? }` | `completion/complete` |

### Assertions (`expect`)

`expect` maps a **dot-path into the result** to a matcher — or to a literal, which
is shorthand for `equals`. Two virtual fields are always available: `isError` (a
boolean, even when the server omits it) and `text` (every text block joined);
`list` steps also add `names`.

```yaml
expect:
  isError: false                       # literal -> equals
  content.0.text: { equals: "hi" }
  text: { contains: "weather" }
  text: { matches: "temp.*[0-9]+" }    # regex (JS RegExp)
  structuredContent.temp: { type: number, gte: -50, lte: 60 }
  structuredContent.city: { oneOf: ["NYC", "LA"] }
  names: { contains: "echo" }          # list step
  structuredContent.optional: { exists: false }
```

Matchers: `equals`, `contains` (substring / array membership), `matches` (regex),
`exists`, `type` (`string|number|boolean|object|array|null`), `gt`/`gte`/`lt`/`lte`,
`oneOf`, `length`. Combine several in one object (e.g. `{ gte: 0, lte: 100 }`). A
path can carry only one matcher object — to assert two things about the same
value, use two steps. Keys containing literal dots aren't addressable.

### Variables

`${name}` and `${env.VAR}` are interpolated in step arguments and matcher values.
Precedence (low → high): `--var k=v` < suite `vars` < case `vars` < `capture`d
values. A whole-token string (`"${count}"`) preserves the referenced value's type;
a token inside surrounding text is stringified.

### Running & CI

```sh
mcp-inspector test ./suites --filter "echo"          # only cases whose name contains "echo"
mcp-inspector test ./suites --bail                   # stop after the first failing case
mcp-inspector test ./suites --var who=World          # seed a variable (repeatable)
mcp-inspector test ./suites --reporter junit --out results.xml
```

| Reporter             | Output                                          |
|----------------------|-------------------------------------------------|
| `console` (default)  | Colored pass/fail tree with failure diffs.      |
| `json` (or `--json`) | The full structured report.                     |
| `junit`              | JUnit XML (GitHub Actions / GitLab / Jenkins).  |
| `tap`                | TAP version 13.                                 |
| `teamcity`           | TeamCity service messages (JetBrains IDEs / TeamCity). |

`--out <file>` writes the report to a file instead of stdout. The command exits
**non-zero** when any case fails, so `mcp-inspector test` works as a CI gate. A
case stops at its first failing step (later steps usually depend on its captures).

### JetBrains / TeamCity integration

The `teamcity` reporter emits [TeamCity service
messages](https://www.jetbrains.com/help/teamcity/service-messages.html) — the
protocol JetBrains IDEs (IntelliJ IDEA, WebStorm, PyCharm, …) and TeamCity parse
off stdout to build their **test tree**. When written to stdout it streams
**live**, so the tree fills in case-by-case as the run progresses, with clickable
failures.

In an IDE, add a **Shell Script** run configuration that runs:

```sh
mcp-inspector test ./mcp-tests --reporter teamcity
```

The Run tool window then shows the live green/red tree. (TeamCity CI picks the
messages up automatically.) The `junit` reporter is the alternative when you'd
rather import a results file after the fact (IDE → *Import Tests from File*, or
TeamCity's XML report processing).

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
mcp-inspector serve --config team.json local.json
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
