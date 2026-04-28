/**
 * `OAuthClientProvider` implementation backed by a JSON file on disk.
 *
 * The MCP SDK's StreamableHTTPClientTransport drives the OAuth dance for us;
 * our job is to:
 *   - persist tokens, dynamically-registered client info, and the active PKCE
 *     code verifier across CLI invocations,
 *   - open the user's browser when the transport asks for authorization,
 *   - run a loopback HTTP server to receive the redirect callback and pull the
 *     authorization `code` back to the caller.
 *
 * The flow is:
 *   1. transport.connect() → provider.tokens() returns nothing
 *   2. transport calls provider.redirectToAuthorization(url) and throws
 *      UnauthorizedError
 *   3. caller awaits the loopback server for the `code` query param
 *   4. caller calls transport.finishAuth(code) — transport exchanges the code,
 *      provider.saveTokens() persists, transport.connect() succeeds on retry
 */

import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import path from "node:path";
import open from "open";

import type {
  OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

type Persisted = {
  clientInformation?: OAuthClientInformationFull;
  tokens?: OAuthTokens;
  codeVerifier?: string;
};

export interface FileOAuthProviderOptions {
  /** Absolute path to the JSON file that stores tokens & client info. */
  file: string;
  /** Loopback redirect URL, e.g. `http://127.0.0.1:33418/callback`. */
  redirectUrl: string;
  /** OAuth client metadata sent during dynamic client registration. */
  clientMetadata: OAuthClientMetadata;
  /** Called when the SDK wants to open the authorization URL in a browser. */
  onRedirect: (url: URL) => void | Promise<void>;
}

export class FileOAuthProvider implements OAuthClientProvider {
  private cache: Persisted = {};
  private loaded = false;
  private readonly file: string;
  private readonly _redirectUrl: string;
  private readonly _clientMetadata: OAuthClientMetadata;
  private readonly onRedirect: (url: URL) => void | Promise<void>;

  constructor(opts: FileOAuthProviderOptions) {
    this.file = opts.file;
    this._redirectUrl = opts.redirectUrl;
    this._clientMetadata = opts.clientMetadata;
    this.onRedirect = opts.onRedirect;
  }

  get redirectUrl(): string {
    return this._redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this._clientMetadata;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.file, "utf8");
      this.cache = JSON.parse(raw) as Persisted;
    } catch (e) {
      if (!isENOENT(e)) throw e;
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(
      this.file,
      JSON.stringify(this.cache, null, 2),
      { mode: 0o600 },
    );
  }

  async clientInformation(): Promise<OAuthClientInformationFull | undefined> {
    await this.load();
    return this.cache.clientInformation;
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await this.load();
    this.cache.clientInformation = info;
    await this.save();
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    await this.load();
    return this.cache.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.load();
    this.cache.tokens = tokens;
    await this.save();
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.load();
    this.cache.codeVerifier = codeVerifier;
    await this.save();
  }

  async codeVerifier(): Promise<string> {
    await this.load();
    if (!this.cache.codeVerifier) {
      throw new Error("No PKCE code verifier on disk; restart the auth flow.");
    }
    return this.cache.codeVerifier;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.onRedirect(authorizationUrl);
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier",
  ): Promise<void> {
    await this.load();
    if (scope === "all" || scope === "tokens") delete this.cache.tokens;
    if (scope === "all" || scope === "client") delete this.cache.clientInformation;
    if (scope === "all" || scope === "verifier") delete this.cache.codeVerifier;
    await this.save();
  }
}

/* ------------------------------------------------------------------ */
/* Loopback callback server                                            */
/* ------------------------------------------------------------------ */

export interface CallbackResult {
  /** OAuth authorization code returned by the auth server. */
  code: string;
  /** Optional state string echoed back, useful for CSRF defence. */
  state: string | null;
}

export interface LoopbackHandle {
  /** Loopback URL to register as the redirect_uri (always 127.0.0.1). */
  redirectUrl: string;
  /** Resolves when the auth server hits the redirect URL with `?code=...`. */
  waitForCode(): Promise<CallbackResult>;
  /** Forcefully close the loopback server (no-op if already closed). */
  close(): void;
}

/**
 * Start an HTTP server bound to 127.0.0.1 on a random port that resolves
 * the next time the auth server redirects to `/callback`.
 *
 * RFC 8252 §7.3 / OAuth 2.1: redirect URIs for native CLI clients should use
 * the literal loopback IP, not `localhost`.
 */
export async function startLoopbackCallback(
  preferredPort?: number,
): Promise<LoopbackHandle> {
  let resolveCode: ((c: CallbackResult) => void) | null = null;
  let rejectCode: ((e: Error) => void) | null = null;
  const codePromise = new Promise<CallbackResult>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server: Server = createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end("missing URL");
      return;
    }
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname !== "/callback") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    const code = u.searchParams.get("code");
    const error = u.searchParams.get("error");
    const errorDescription = u.searchParams.get("error_description");
    const state = u.searchParams.get("state");

    if (code) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(SUCCESS_HTML);
      resolveCode?.({ code, state });
    } else {
      const msg = error
        ? `${error}${errorDescription ? `: ${errorDescription}` : ""}`
        : "No authorization code received";
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(failureHtml(msg));
      rejectCode?.(new Error(msg));
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onErr = (e: Error) => {
      server.removeListener("listening", onListen);
      reject(e);
    };
    const onListen = () => {
      server.removeListener("error", onErr);
      resolve();
    };
    server.once("error", onErr);
    server.once("listening", onListen);
    server.listen(preferredPort ?? 0, "127.0.0.1");
  });

  const addr = server.address() as AddressInfo;
  const redirectUrl = `http://127.0.0.1:${addr.port}/callback`;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    server.close();
  };

  return {
    redirectUrl,
    close,
    async waitForCode() {
      try {
        return await codePromise;
      } finally {
        close();
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Default browser opener (used as `onRedirect` callback)              */
/* ------------------------------------------------------------------ */

export async function openInBrowser(url: URL): Promise<void> {
  await open(url.toString());
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isENOENT(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "ENOENT"
  );
}

const SUCCESS_HTML = `<!doctype html>
<html><head><title>Authorized</title>
<style>body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#161b22;padding:2rem 3rem;border-radius:8px;
border:1px solid #30363d;text-align:center}
h1{margin:0 0 .5rem;font-size:1.25rem}
p{margin:0;color:#8b949e}</style></head>
<body><div class="card"><h1>&check; Authorized</h1>
<p>You can close this tab and return to the CLI.</p></div></body></html>`;

function failureHtml(msg: string): string {
  const escaped = msg.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  return `<!doctype html>
<html><head><title>Authorization failed</title>
<style>body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#161b22;padding:2rem 3rem;border-radius:8px;
border:1px solid #f85149;text-align:center;max-width:480px}
h1{margin:0 0 .5rem;font-size:1.25rem;color:#f85149}
p{margin:0;color:#8b949e;word-wrap:break-word}</style></head>
<body><div class="card"><h1>&times; Authorization failed</h1>
<p>${escaped}</p></div></body></html>`;
}
