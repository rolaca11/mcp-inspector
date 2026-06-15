/**
 * Session pool shared by the dashboard server (`mcp-inspector serve`) and the
 * Electron app. Holds one MCP session per server name and evicts sessions
 * after an idle timeout.
 *
 * Sessions returned by `acquire()` are self-healing: when the server reports
 * that the negotiated `Mcp-Session-Id` is gone (HTTP 404 per the Streamable
 * HTTP spec, or a 400 "session"-shaped rejection — typical after a dev-server
 * restart), the pool reconnects — re-running `initialize` so every following
 * request carries a fresh, valid session ID — and replays the failed call
 * once.
 */

import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { connect, type Session } from "./client.js";

export const SESSION_IDLE_MS = 5 * 60 * 1000;

export interface SessionPool {
  acquire(name: string): Promise<Session>;
  release(name: string, hard?: boolean): Promise<void>;
  closeAll(): Promise<void>;
}

export interface SessionPoolOptions {
  /** Called when a server needs interactive OAuth; receives the auth URL. */
  onAuthRedirect?: (name: string, url: URL) => void;
  /** Idle eviction window in milliseconds. Defaults to `SESSION_IDLE_MS`. */
  idleMs?: number;
  /** Connection factory — injectable for tests. */
  connectFn?: typeof connect;
}

/**
 * Client methods that perform server round-trips and are safe to replay on a
 * fresh session. Sync accessors (`getServerCapabilities`, ...) and lifecycle
 * methods stay untouched.
 */
const RETRYABLE_METHODS = new Set([
  "ping",
  "complete",
  "setLoggingLevel",
  "getPrompt",
  "listPrompts",
  "listResources",
  "listResourceTemplates",
  "readResource",
  "subscribeResource",
  "unsubscribeResource",
  "callTool",
  "listTools",
  "request",
  "notification",
]);

/** True when the server says our session ID is no longer valid. */
function isSessionExpired(e: unknown): boolean {
  if (!(e instanceof StreamableHTTPError)) return false;
  if (e.code === 404) return true; // spec: unknown/terminated session
  return e.code === 400 && /session|not initialized/i.test(e.message);
}

export function createSessionPool(opts: SessionPoolOptions = {}): SessionPool {
  const idleMs = opts.idleMs ?? SESSION_IDLE_MS;
  const connectFn = opts.connectFn ?? connect;

  interface Entry {
    session: Session | null;
    facade: Session | null;
    pending: Promise<Session> | null;
    timer: NodeJS.Timeout | null;
  }
  const entries = new Map<string, Entry>();

  function touch(name: string, entry: Entry): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void release(name, true), idleMs);
    entry.timer.unref?.();
  }

  /** Connect (or reuse) and resolve the raw, unwrapped session. */
  async function acquireRaw(name: string): Promise<Session> {
    let entry = entries.get(name);
    if (!entry) {
      entry = { session: null, facade: null, pending: null, timer: null };
      entries.set(name, entry);
    }

    touch(name, entry);

    if (entry.session) return entry.session;
    if (entry.pending) return entry.pending;

    entry.pending = connectFn(name, {
      onRedirect: (url) => {
        opts.onAuthRedirect?.(name, url);
      },
    })
      .then((s) => {
        entry.session = s;
        entry.facade = healingFacade(name, s);
        entry.pending = null;
        return s;
      })
      .catch((err) => {
        entry.pending = null;
        throw err;
      });

    return entry.pending;
  }

  /** Drop `failed` (if still pooled) and connect a fresh session. */
  async function reacquire(name: string, failed: Session): Promise<Session> {
    const entry = entries.get(name);
    if (entry && entry.session === failed) {
      await release(name, true);
    }
    return acquireRaw(name);
  }

  /**
   * A `Session` whose round-trip methods reconnect and replay once when the
   * server rejects our session ID. The replay uses the raw client so a
   * pathological server can't trap us in a heal loop.
   */
  function healingFacade(name: string, real: Session): Session {
    const client = new Proxy(real.client, {
      get(target, prop) {
        // Receiver must be the real client: getters/methods may touch private
        // state that a proxy receiver cannot reach.
        const value = Reflect.get(target, prop, target);
        if (
          typeof value !== "function" ||
          typeof prop !== "string" ||
          !RETRYABLE_METHODS.has(prop)
        ) {
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async (...args: unknown[]) => {
          try {
            return await value.apply(target, args);
          } catch (e) {
            if (!isSessionExpired(e)) throw e;
            const fresh = await reacquire(name, real);
            const replay = (fresh.client as unknown as Record<string, unknown>)[
              prop
            ];
            if (typeof replay !== "function") throw e;
            return (replay as (...a: unknown[]) => unknown).apply(
              fresh.client,
              args,
            );
          }
        };
      },
    });
    return {
      client,
      target: real.target,
      id: real.id,
      close: () => real.close(),
    };
  }

  async function acquire(name: string): Promise<Session> {
    await acquireRaw(name);
    const facade = entries.get(name)?.facade;
    if (!facade) throw new Error(`session for ${name} vanished during acquire`);
    return facade;
  }

  async function release(name: string, hard = false): Promise<void> {
    const entry = entries.get(name);
    if (!entry) return;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (hard) {
      const s = entry.session;
      entry.session = null;
      entry.facade = null;
      entries.delete(name);
      if (s) await s.close();
    }
  }

  async function closeAll(): Promise<void> {
    const all = Array.from(entries.keys());
    for (const name of all) await release(name, true);
  }

  return { acquire, release, closeAll };
}
