import * as React from "react";
import {
  AlertCircle,
  ArrowRight,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCcw,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CodeBlock } from "@/components/code-block";
import { Empty } from "@/components/empty";
import { PageShell } from "@/components/page-shell";
import { StatusDot } from "@/components/status-dot";
import { useServer } from "@/contexts/server-context";
import { api, ApiError } from "@/data/api";
import type { AuthStatus } from "@/data/types";

export function AuthPage() {
  const { server, rediscover } = useServer();
  const isHttp = server.transport !== "stdio";

  const [status, setStatus] = React.useState<AuthStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"logout" | "reauth" | null>(null);

  const load = React.useCallback(async () => {
    if (!isHttp) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.authStatus(server.name);
      setStatus(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isHttp, server.name]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const onLogout = React.useCallback(async () => {
    setBusy("logout");
    setError(null);
    try {
      await api.authLogout(server.name);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [server.name, load]);

  const onReauth = React.useCallback(async () => {
    setBusy("reauth");
    setError(null);
    try {
      // Drop credentials, then trigger a discover so the server reconnects
      // (which will run the OAuth flow if the transport demands it).
      await api.authLogout(server.name);
      await rediscover();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [server.name, rediscover, load]);

  return (
    <PageShell
      title="Auth"
      description={
        isHttp
          ? "OAuth 2.1 + PKCE state for this HTTP MCP server. mcp-inspector stores tokens, refresh tokens, and dynamic client registration on disk."
          : "stdio transports inherit the parent process environment. There is no OAuth state to manage."
      }
    >
      {!isHttp && (
        <Card>
          <CardContent className="flex items-center gap-4 py-8">
            <span className="grid place-items-center size-10 rounded-full bg-muted/40 text-muted-foreground">
              <ShieldOff className="size-5" />
            </span>
            <div>
              <div className="font-medium">No auth required</div>
              <div className="text-sm text-muted-foreground">
                <span className="font-mono">{server.name}</span> uses the
                <span className="mx-1 font-mono">stdio</span>
                transport. The child process inherits this CLI&apos;s
                environment.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isHttp && error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertCircle className="size-5 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">Couldn't read auth state</div>
              <div className="text-sm text-muted-foreground mt-0.5 break-all">
                {error}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isHttp && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              {loading && !status ? (
                <Badge variant="muted">
                  <Loader2 className="size-3 animate-spin" />
                  loading…
                </Badge>
              ) : status?.exists ? (
                <Badge variant="success">
                  <ShieldCheck className="size-3" />
                  authenticated
                </Badge>
              ) : (
                <Badge variant="warning">
                  <ShieldOff className="size-3" />
                  not authenticated
                </Badge>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {!status ? (
                <Empty
                  title="Loading auth state…"
                  description="Reading the on-disk token store."
                />
              ) : !status.exists ? (
                <Empty
                  icon={ShieldOff}
                  title="No tokens on file"
                  description="Click Re-authenticate to run the OAuth flow."
                  actionLabel="Re-authenticate"
                  onAction={onReauth}
                />
              ) : (
                <div className="grid gap-3">
                  <Row
                    label="tokens"
                    ok={!!status.hasTokens}
                    text={status.hasTokens ? "yes" : "no"}
                  />
                  <Row
                    label="refresh token"
                    ok={!!status.hasRefreshToken}
                    text={status.hasRefreshToken ? "yes" : "no"}
                  />
                  <Row
                    label="registered client"
                    ok={!!status.hasClientInfo}
                    text={status.hasClientInfo ? "yes" : "no"}
                  />
                  {status.tokenType && (
                    <Row
                      label="token type"
                      text={
                        <span className="font-mono">{status.tokenType}</span>
                      }
                    />
                  )}
                  {status.scope && (
                    <Row
                      label="scope"
                      text={<span className="font-mono">{status.scope}</span>}
                    />
                  )}
                </div>
              )}
              {status && (
                <>
                  <Separator />
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-1.5">
                      Token store
                    </div>
                    <CodeBlock copyable={false} language="path">
                      {status.file}
                    </CodeBlock>
                    <div className="mt-1.5 text-[11px] text-muted-foreground/70">
                      Created with mode <span className="font-mono">0600</span>.
                    </div>
                  </div>
                </>
              )}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void load()}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="size-3.5" />
                  )}
                  Refresh
                </Button>
                <Button
                  variant="success"
                  size="sm"
                  onClick={onReauth}
                  disabled={busy != null}
                >
                  {busy === "reauth" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <KeyRound className="size-3.5" />
                  )}
                  Re-authenticate
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onLogout}
                  disabled={busy != null || !status?.exists}
                >
                  {busy === "logout" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <LogOut className="size-3.5" />
                  )}
                  Logout
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>OAuth flow</CardTitle>
              <CardDescription className="hidden md:block">
                Streamable HTTP · PKCE · loopback callback
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {OAUTH_STEPS.map((step, idx) => (
                <div
                  key={step.title}
                  className="flex items-start gap-3 rounded-md border border-border/40 bg-card/30 px-3 py-2.5"
                >
                  <span className="grid size-5 mt-0.5 place-items-center rounded-full bg-foreground/10 text-[11px] font-mono tabular-nums">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{step.title}</span>
                      {step.tag && (
                        <Badge variant="muted" className="font-mono">
                          {step.tag}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground/80 mt-0.5">
                      {step.description}
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-2 rounded-md border border-border/40 bg-card/30 px-3 py-2.5">
                <ArrowRight className="size-3.5 text-muted-foreground" />
                <span className="font-mono text-xs text-muted-foreground">
                  Tokens persist at{" "}
                  <span className="text-foreground/80">
                    $XDG_CONFIG_HOME/mcp-inspector/auth/&lt;target-id&gt;.json
                  </span>
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}

function Row({
  label,
  ok,
  text,
}: {
  label: string;
  ok?: boolean;
  text: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-card/30 px-3 py-2">
      <div className="flex items-center gap-3 text-sm">
        {ok != null && <StatusDot tone={ok ? "success" : "muted"} />}
        <span className="text-muted-foreground">{label}</span>
      </div>
      <span className="text-sm">{text}</span>
    </div>
  );
}

const OAUTH_STEPS = [
  {
    title: "Read tokens from disk",
    description:
      "If tokens exist and aren't expired, the transport reuses them silently — no browser pop-up.",
    tag: "fast path",
  },
  {
    title: "Bind a loopback HTTP server",
    description: "Random port on 127.0.0.1 to receive the redirect URI.",
    tag: "RFC 8252",
  },
  {
    title: "Dynamic client registration",
    description:
      "Register this CLI with the auth server using the loopback URL as redirect.",
  },
  {
    title: "Authorize in the user's browser",
    description: "open(url) launches the default browser with code_challenge (PKCE).",
  },
  {
    title: "Exchange code for tokens",
    description:
      "transport.finishAuth(code) exchanges the code for an access + refresh token pair.",
    tag: "PKCE",
  },
];
