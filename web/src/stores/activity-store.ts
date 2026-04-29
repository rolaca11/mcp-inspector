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
  at: string;
}

interface ActivityState {
  entries: ActivityEntry[];

  start(input: Omit<ActivityEntry, "id" | "outcome" | "at" | "durationMs">): {
    id: string;
    finish(detail?: string, tokenCount?: number | null): void;
    fail(error: string): void;
  };

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
      finish: (detail, tokenCount) => {
        patch({
          outcome: "ok",
          durationMs: Math.round(performance.now() - startedAt),
          ...(detail != null ? { detail } : {}),
          ...(tokenCount != null ? { tokenCount } : {}),
        });
      },
      fail: (error) => {
        patch({
          outcome: "error",
          durationMs: Math.round(performance.now() - startedAt),
          error,
        });
      },
    };
  },

  clear() {
    set({ entries: [] });
  },
}));
