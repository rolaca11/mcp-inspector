/**
 * Zustand store for the in-memory activity log. Records every API call so
 * the dashboard can render a recent-activity feed. Bounded to 100 entries.
 *
 * Because this is a plain Zustand store, non-React code (e.g. `api.ts`) can
 * call `useActivityStore.getState().start(...)` without hooks.
 */

import { create } from "zustand";

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
  response?: unknown;
  at: string;
}

interface ActivityState {
  entries: ActivityEntry[];

  start(input: Omit<ActivityEntry, "id" | "outcome" | "at" | "durationMs">): {
    id: string;
    finish(detail?: string, tokenCount?: number | null, response?: unknown): void;
    fail(error: string, response?: unknown): void;
  };

  insert(entries: Array<{
    kind: ActivityKind;
    serverName: string;
    target: string;
    outcome: "ok" | "error";
    durationMs: number;
    tokenCount?: number | null;
    error?: string;
    response?: unknown;
  }>): void;

  clear(): void;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export const useActivityStore = create<ActivityState>((set) => ({
  entries: [],

  start(input) {
    const entry: ActivityEntry = {
      id: cryptoRandomId(),
      outcome: "pending",
      at: new Date().toISOString(),
      ...input,
    };
    set((s) => ({
      entries: [entry, ...s.entries].slice(0, MAX_ENTRIES),
    }));
    const startedAt = performance.now();

    const patch = (p: Partial<ActivityEntry>) =>
      set((s) => ({
        entries: s.entries.map((e) => (e.id === entry.id ? { ...e, ...p } : e)),
      }));

    return {
      id: entry.id,
      finish: (detail, tokenCount, response) => {
        patch({
          outcome: "ok",
          durationMs: Math.round(performance.now() - startedAt),
          ...(detail != null ? { detail } : {}),
          ...(tokenCount != null ? { tokenCount } : {}),
          ...(response !== undefined ? { response } : {}),
        });
      },
      fail: (error, response) => {
        patch({
          outcome: "error",
          durationMs: Math.round(performance.now() - startedAt),
          error,
          ...(response !== undefined ? { response } : {}),
        });
      },
    };
  },

  insert(incoming) {
    const now = new Date().toISOString();
    const newEntries: ActivityEntry[] = incoming.map((e) => ({
      id: cryptoRandomId(),
      kind: e.kind,
      serverName: e.serverName,
      target: e.target,
      outcome: e.outcome,
      durationMs: e.durationMs,
      ...(e.tokenCount != null ? { tokenCount: e.tokenCount } : {}),
      ...(e.error != null ? { error: e.error } : {}),
      ...(e.response !== undefined ? { response: e.response } : {}),
      at: now,
    }));
    set((s) => ({
      entries: [...newEntries, ...s.entries].slice(0, MAX_ENTRIES),
    }));
  },

  clear() {
    set({ entries: [] });
  },
}));
