/**
 * In-memory log of every API call. Subscribe via `useActivity()` to render
 * a recent-activity feed. Bounded — we keep the most recent 100 entries.
 */

const MAX_ENTRIES = 100;

export type ActivityKind =
  | "tool-call"
  | "resource-read"
  | "prompt-get"
  | "complete"
  | "discover"
  | "auth"
  | "disconnect";

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  serverName: string;
  target: string;
  detail?: string;
  outcome: "ok" | "error" | "pending";
  durationMs?: number;
  /** Token count from the Anthropic Token Counting API (when available). */
  tokenCount?: number | null;
  error?: string;
  at: string;
}

type Listener = (entries: ActivityEntry[]) => void;

class ActivityLog {
  #entries: ActivityEntry[] = [];
  #listeners = new Set<Listener>();

  list(): ActivityEntry[] {
    return this.#entries;
  }

  start(input: Omit<ActivityEntry, "id" | "outcome" | "at" | "durationMs">): {
    id: string;
    finish(detail?: string, tokenCount?: number | null): void;
    fail(error: string): void;
  } {
    const entry: ActivityEntry = {
      id: cryptoRandomId(),
      outcome: "pending",
      at: new Date().toISOString(),
      ...input,
    };
    this.#prepend(entry);
    const startedAt = performance.now();
    return {
      id: entry.id,
      finish: (detail, tokenCount) => {
        this.#patch(entry.id, {
          outcome: "ok",
          durationMs: Math.round(performance.now() - startedAt),
          ...(detail != null ? { detail } : {}),
          ...(tokenCount != null ? { tokenCount } : {}),
        });
      },
      fail: (error) => {
        this.#patch(entry.id, {
          outcome: "error",
          durationMs: Math.round(performance.now() - startedAt),
          error,
        });
      },
    };
  }

  subscribe(fn: Listener): () => void {
    this.#listeners.add(fn);
    fn(this.#entries);
    return () => this.#listeners.delete(fn);
  }

  clear(): void {
    this.#entries = [];
    this.#emit();
  }

  #prepend(entry: ActivityEntry) {
    this.#entries = [entry, ...this.#entries].slice(0, MAX_ENTRIES);
    this.#emit();
  }

  #patch(id: string, patch: Partial<ActivityEntry>) {
    let changed = false;
    this.#entries = this.#entries.map((e) => {
      if (e.id !== id) return e;
      changed = true;
      return { ...e, ...patch };
    });
    if (changed) this.#emit();
  }

  #emit() {
    for (const fn of this.#listeners) fn(this.#entries);
  }
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export const activityLog = new ActivityLog();
