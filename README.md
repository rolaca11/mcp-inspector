# MCP Inspector

<img width="150" src="packages/web/public/favicon.svg">

A user-experience focused [Model Context Protocol](https://modelcontextprotocol.io) client.

## Usage

### GUI

You can find the desktop app [here](https://github.com/rolaca11/mcp-inspector/releases/latest),
or you can run the following command for a server-client setup in your browser:

```bash
npx @rolaca11/mcp-inspector serve
```

<img src="docs/images/overview.png">

See basic server stats, or server communication logs.

<img src="docs/images/resources-with-completion.png">

Query resources, even dynamic ones, with completion, without cache. Find an approximate
token count for the response.

<img src="docs/images/tools.png">

Call tools with rich input forms, a JSON editor where you can see the request, copy it,
or paste into it. You can find an approximate token count for the response. Form values
are saved in global state, so you can switch between tools/resources without needing to
re-enter your inputs.

### MCP Apps (interactive UIs)

The inspector supports [MCP Apps](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp)
(SEP-1865). It advertises the `io.modelcontextprotocol/ui` extension during
`initialize`, so servers expose their UI-enabled tools, and renders those apps
in a sandboxed iframe.

- Tools that declare a UI (`_meta.ui.resourceUri`, the deprecated
  `ui/resourceUri`, or the OpenAI `openai/outputTemplate` alias) are flagged with
  an app icon. Calling such a tool fetches its `ui://` template and renders it
  beneath the response, fed the tool's input and result.
- The host side is the official [`@modelcontextprotocol/ext-apps`](https://www.npmjs.com/package/@modelcontextprotocol/ext-apps)
  `AppBridge` over `postMessage`: `ui/initialize` → `ui/notifications/initialized`
  → `ui/notifications/tool-input` / `tool-result`, plus app-initiated `tools/call`,
  `resources/read`, `ui/open-link`, `ui/message`, display-mode and resize
  requests. Tool calls and resource reads are proxied to the server through the
  inspector's API, so they also appear in the activity feed; every message the
  app exchanges with the host is shown in a live log.
- Embedded `ui://` resources in a tool result (`text/html`, `text/uri-list`) are
  rendered inline, and UI resources can be previewed directly from the
  **Resources** tab.

Apps render in a **sandbox proxy** on a sibling origin (`127.0.0.1`↔`localhost`,
or a dedicated host for the Electron `app:` scheme), as the spec prescribes —
mirroring the official MCP Inspector's proxy. This lets the app be granted
`allow-same-origin` — so storage, workers, and frameworks like CesiumJS work —
while staying cross-origin to the dashboard, unable to reach its DOM, storage, or
API. The proxy injects the app via `document.write` rather than `srcdoc` (a
`srcdoc` document loads at `about:srcdoc`, which breaks some apps' workers and
relative-URL resolution). If no sibling origin is reachable, the host falls back
to an opaque-origin inline `srcdoc` (no same-origin; simple apps still render).
When a resource declares `_meta.ui.csp`, its origin allowlist is enforced exactly;
otherwise a permissive policy is used so apps actually render.

### Server sources

The inspector has its own server config file at `~/.config/mcp-inspector/mcp.json`
(honoring `$XDG_CONFIG_HOME`). It's created automatically on first launch, and you
can add more servers there, edit the config, or delete it to reset the config from
the GUI. It also searches for `.mcp.json` files in the current working directory and your home
directory. It means that if you use the web GUI, you can run `mcp-inspector serve`
from the directory of your project, and it'll find servers in `./.mcp.json`.

You can also specify one, or more files to read in the CLI with:
```bash
mcp-inspector serve --config /path/to/first/.mcp.json /path/to/second/.mcp.json
```

---

### CLI

Read more about CLI usage [here](packages/cli/README.md)

## Project layout

The repo is a Bun monorepo with four packages:

```
packages/
├── core/                 # shared library — all other packages depend on this
│   └── src/
│       ├── client.ts     # connect() — picks transport, runs OAuth flow with retry
│       ├── actions.ts    # primitive actions used by CLI, REPL, and tRPC
│       ├── apps.ts       # MCP Apps (SEP-1865) constants + _meta/UI detection
│       ├── config.ts     # .mcp.json loader (cwd + home, with merging)
│       ├── oauth.ts      # FileOAuthProvider + loopback callback server
│       ├── target.ts     # parse "target" string into transport spec
│       ├── format.ts     # pretty-printers (resources, tools, prompts, …)
│       ├── paths.ts      # OAuth config-dir helpers
│       ├── tokens.ts     # token helpers
│       ├── trpc/         # tRPC router, schemas, and activity tracking
│       └── __tests__/    # vitest unit tests
│
├── cli/                  # CLI + REPL + HTTP server → published as @rolaca11/mcp-inspector
│   └── src/
│       ├── cli.ts        # commander entry point — wires every subcommand
│       ├── repl.ts       # interactive readline REPL
│       └── server.ts     # `mcp-inspector serve` — hosts UI + tRPC API
│
├── web/                  # React 19 dashboard (Tailwind v4 · shadcn/ui)
│   ├── index.html
│   ├── public/
│   └── src/
│       ├── App.tsx
│       ├── pages/        # overview, resources, tools, prompts, completions, auth, servers
│       ├── components/   # header, nav-tabs, mcp-app-frame (sandboxed app host), ui/* …
│       ├── stores/       # Zustand state (activity, connection, results, …)
│       ├── data/         # tRPC client + types
│       ├── hooks/
│       └── lib/          # utilities, schema builder, mcp-apps protocol + app-content
│
└── electron/             # native desktop app
    ├── src/
    │   ├── main.ts       # Electron main process — embeds tRPC server
    │   └── preload.ts    # IPC preload script
    └── electron-builder.yml
```

Core exports are consumed by all other packages. CLI and REPL call
`actions.ts`; the web dashboard and Electron app use the tRPC router. All
four share the same OAuth state and `.mcp.json` resolution.

---

## Development

```sh
bun run dev:cli -- discover "npx -y @modelcontextprotocol/server-everything stdio"

# Dashboard with HMR:
bun run dev:cli -- serve --no-open --no-ui   # API on :8765 in one terminal
bun run dev:ui                                # Vite dev server on :5173 with /api/trpc proxy

# Electron:
bun run dev:electron                          # launches the desktop app in dev mode

bun run typecheck    # type-check all packages
bun run test         # run tests across all packages
bun run build        # production build (web + CLI)
bun run clean        # rm -rf packages/*/dist
```
