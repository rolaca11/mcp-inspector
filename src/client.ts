/**
 * Builds an MCP `Client` connected to the requested target. Wraps the OAuth
 * dance for HTTP servers — the caller just `await`s `connect()` and gets back
 * a session it can `close()` when finished.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import type { OAuthClientMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";

import pc from "picocolors";

import { authFile } from "./paths.js";
import {
  FileOAuthProvider,
  openInBrowser,
  startLoopbackCallback,
} from "./oauth.js";
import { parseTarget, targetId, type TargetSpec } from "./target.js";

const CLIENT_INFO: Implementation = {
  name: "mcp-inspector",
  version: "0.1.0",
};

export interface ConnectOptions {
  /** Override the OAuth client name reported during dynamic client registration. */
  clientName?: string;
  /** Custom scope string requested during authorization. */
  scope?: string;
  /** Suppress informational stderr logging during auth. */
  quiet?: boolean;
}

export interface Session {
  client: Client;
  target: TargetSpec;
  /** Filesystem-safe identifier for the target — used as the auth-file slug. */
  id: string;
  /** Tear down the transport and any auxiliary resources. */
  close(): Promise<void>;
}

/**
 * Connect to an MCP server. For HTTP servers this transparently runs the
 * OAuth authorization-code flow on the first call (or when stored tokens are
 * rejected), persisting tokens in `~/.config/mcp-inspector/auth/<id>.json`.
 */
export async function connect(
  rawTarget: string | TargetSpec,
  opts: ConnectOptions = {},
): Promise<Session> {
  const target =
    typeof rawTarget === "string" ? parseTarget(rawTarget) : rawTarget;
  const id = targetId(target);

  if (target.kind === "stdio") {
    return connectStdio(target, id);
  }
  return connectHttp(target, id, opts);
}

async function connectStdio(
  target: Extract<TargetSpec, { kind: "stdio" }>,
  id: string,
): Promise<Session> {
  const baseEnv = process.env as Record<string, string>;
  const env = target.env ? { ...baseEnv, ...target.env } : baseEnv;

  const transport = new StdioClientTransport({
    command: target.command,
    args: target.args,
    env,
    stderr: "inherit",
    ...(target.cwd ? { cwd: target.cwd } : {}),
  });
  const client = new Client(CLIENT_INFO, { capabilities: {} });
  await client.connect(transport);

  return {
    client,
    target,
    id,
    async close() {
      await client.close().catch(() => {});
    },
  };
}

async function connectHttp(
  target: Extract<TargetSpec, { kind: "http" }>,
  id: string,
  opts: ConnectOptions,
): Promise<Session> {
  const file = authFile(id);
  const log = (...args: unknown[]) => {
    if (!opts.quiet) console.error(pc.dim("[auth]"), ...args);
  };

  // Reuse stored tokens if any. We start the loopback server only when needed
  // because once a tab is opened the user expects the CLI to be waiting.
  const buildClient = () => new Client(CLIENT_INFO, { capabilities: {} });

  // Extra HTTP headers from a named-config entry get forwarded to every
  // transport request via `requestInit.headers`.
  const transportOpts = (extra: { authProvider: FileOAuthProvider }) =>
    target.headers && Object.keys(target.headers).length > 0
      ? { ...extra, requestInit: { headers: { ...target.headers } } }
      : extra;

  // -- First attempt: assume tokens already exist (or DCR done previously).
  // We still need a redirectUrl for the provider — but if no tokens nor
  // refresh succeed we'll discard this transport and rebuild with a real
  // loopback URL.

  let client = buildClient();
  let provider = new FileOAuthProvider({
    file,
    redirectUrl: "http://127.0.0.1:0/callback", // placeholder; not used unless we authorize
    clientMetadata: defaultClientMetadata(
      "http://127.0.0.1:0/callback",
      opts.clientName,
      opts.scope,
    ),
    onRedirect: () => {
      // Not expected on the silent attempt; if it does fire we'll fall through
      // to UnauthorizedError below.
    },
  });
  let transport = new StreamableHTTPClientTransport(
    target.url,
    transportOpts({ authProvider: provider }),
  );

  try {
    await client.connect(transport);
    return wrapSession(client, transport, target, id);
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) {
      await safeClose(client);
      throw e;
    }
    // Throw away that transport — we need to re-run the flow with a real
    // loopback URL so the auth server can redirect back to us.
    await safeClose(client);
  }

  log("starting interactive OAuth flow");

  // -- Second attempt: full OAuth flow with a fresh loopback server.
  const loopback = await startLoopbackCallback();
  log(`loopback redirect: ${loopback.redirectUrl}`);

  // Wipe any stale credentials so the SDK does a clean DCR + authorize with
  // the new redirect URI. (Different runs may bind to different ports.)
  await provider.invalidateCredentials("all");

  let openedAuthUrl: URL | null = null;
  provider = new FileOAuthProvider({
    file,
    redirectUrl: loopback.redirectUrl,
    clientMetadata: defaultClientMetadata(
      loopback.redirectUrl,
      opts.clientName,
      opts.scope,
    ),
    onRedirect: async (url) => {
      openedAuthUrl = url;
      log("opening browser:", pc.cyan(url.toString()));
      try {
        await openInBrowser(url);
      } catch (e) {
        log(pc.yellow("could not auto-open browser; visit the URL above manually"));
      }
    },
  });

  client = buildClient();
  transport = new StreamableHTTPClientTransport(
    target.url,
    transportOpts({ authProvider: provider }),
  );

  try {
    await client.connect(transport);
    // Surprise: tokens worked on the second attempt without any redirect.
    loopback.close();
    return wrapSession(client, transport, target, id);
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) {
      loopback.close();
      await safeClose(client);
      throw e;
    }
  }

  if (!openedAuthUrl) {
    loopback.close();
    await safeClose(client);
    throw new Error(
      "Transport requested authorization but never produced an authorization URL.",
    );
  }

  log("waiting for authorization callback...");
  const { code } = await loopback.waitForCode();
  log("received authorization code, exchanging for tokens");

  await transport.finishAuth(code);

  // After finishAuth the transport itself is torn down — rebuild a fresh one
  // that will pick up the freshly stored tokens via the provider.
  await safeClose(client);

  const finalClient = buildClient();
  const finalTransport = new StreamableHTTPClientTransport(
    target.url,
    transportOpts({ authProvider: provider }),
  );
  try {
    await finalClient.connect(finalTransport);
  } catch (e) {
    await safeClose(finalClient);
    throw e;
  }

  return wrapSession(finalClient, finalTransport, target, id);
}

function wrapSession(
  client: Client,
  transport: StreamableHTTPClientTransport | StdioClientTransport,
  target: TargetSpec,
  id: string,
): Session {
  return {
    client,
    target,
    id,
    async close() {
      await client.close().catch(() => {});
      await (transport as { close?: () => Promise<void> }).close?.().catch(
        () => {},
      );
    },
  };
}

async function safeClose(client: Client): Promise<void> {
  try {
    await client.close();
  } catch {
    /* ignore */
  }
}

function defaultClientMetadata(
  redirectUrl: string,
  clientName: string | undefined,
  scope: string | undefined,
): OAuthClientMetadata {
  const meta: OAuthClientMetadata = {
    client_name: clientName ?? "mcp-inspector",
    client_uri: "https://github.com/modelcontextprotocol",
    redirect_uris: [redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none", // public client + PKCE
  };
  if (scope) meta.scope = scope;
  return meta;
}
