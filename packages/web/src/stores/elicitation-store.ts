import * as React from "react";
import { create } from "zustand";

import type {
  ElicitationAction,
  ElicitationCompletionEvent,
  ElicitationContent,
  PendingElicitation,
} from "@rolaca11/mcp-inspector-core/elicitation";

import { ApiError, api } from "@/data/api";
import { useActivityStore } from "@/stores/activity-store";
import type { ConnectionState } from "@/stores/connection-store";

export const ACTIVE_POLL_MS = 200;
export const IDLE_POLL_MS = 1500;
export const FOLLOW_UP_POLL_MS = 50;

export type ElicitationFormRawValue = string | boolean | string[] | undefined;

export interface ElicitationFormDraft {
  values: Record<string, ElicitationFormRawValue>;
  touched: Record<string, boolean>;
  submitted: boolean;
}

interface ElicitationState {
  pending: PendingElicitation[];
  completions: ElicitationCompletionEvent[];
  drafts: Record<string, ElicitationFormDraft>;
  inFlightCount: number;
  submittingId: string | null;
  submitError: string | null;
  submitErrorId: string | null;
  unavailable: boolean;

  beginOperation(): void;
  endOperation(): void;
  poll(): Promise<void>;
  respond(id: string, action: ElicitationAction, content?: ElicitationContent): Promise<boolean>;
  setDraft(id: string, draft: ElicitationFormDraft): void;
}

let activePoll: Promise<void> | null = null;
let pollAgain = false;
let generation = 0;

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const useElicitationStore = create<ElicitationState>((set, get) => ({
  pending: [],
  completions: [],
  drafts: {},
  inFlightCount: 0,
  submittingId: null,
  submitError: null,
  submitErrorId: null,
  unavailable: false,

  beginOperation() {
    set((s) => ({ inFlightCount: s.inFlightCount + 1 }));
    void get().poll();
  },

  endOperation() {
    set((s) => ({ inFlightCount: Math.max(0, s.inFlightCount - 1) }));
  },

  poll() {
    if (activePoll) {
      pollAgain = true;
      return activePoll;
    }
    activePoll = (async () => {
      try {
        do {
          pollAgain = false;
          const startedAt = generation;
          try {
            const { pending, completions } = await api.pendingElicitations();
            if (startedAt !== generation) {
              pollAgain = true;
              continue;
            }
            const s = get();
            const ids = new Set(pending.map((p) => p.id));
            const draftEntries = Object.entries(s.drafts).filter(([id]) => ids.has(id));
            const next: Partial<ElicitationState> = {};
            if (!sameJson(s.pending, pending)) next.pending = pending;
            if (!sameJson(s.completions, completions)) next.completions = completions;
            if (draftEntries.length !== Object.keys(s.drafts).length) {
              next.drafts = Object.fromEntries(draftEntries);
            }
            if (s.submitErrorId && !ids.has(s.submitErrorId)) {
              next.submitError = null;
              next.submitErrorId = null;
            }
            if (s.unavailable) next.unavailable = false;
            if (Object.keys(next).length > 0) set(next);
          } catch (e) {
            if (e instanceof ApiError && e.responseBody?.code === "PRECONDITION_FAILED") {
              set({ unavailable: true });
            }
          }
        } while (pollAgain);
      } finally {
        activePoll = null;
      }
    })();
    return activePoll;
  },

  async respond(id, action, content) {
    set({ submittingId: id, submitError: null, submitErrorId: null });
    try {
      const response = await api.respondElicitation({ id, action, content });
      generation++;
      useActivityStore.getState().insert([
        {
          kind: "elicitation",
          serverName: response.serverName,
          target: `${response.params.mode}: ${response.params.message}`,
          outcome: "ok",
          durationMs: response.durationMs,
          request: response.params,
          response: response.result,
        },
      ]);
      set((s) => {
        const { [id]: _, ...remainingDrafts } = s.drafts;
        return {
          pending: s.pending.filter((p) => p.id !== id),
          drafts: remainingDrafts,
          submittingId: null,
        };
      });
      setTimeout(() => void get().poll(), FOLLOW_UP_POLL_MS);
      return true;
    } catch (e) {
      set({
        submittingId: null,
        submitError: e instanceof Error ? e.message : String(e),
        submitErrorId: id,
      });
      if (e instanceof ApiError && e.status === 404) void get().poll();
      return false;
    }
  },

  setDraft(id, draft) {
    set((s) => ({ drafts: { ...s.drafts, [id]: draft } }));
  },
}));

export function useElicitationPoller(connectionState: ConnectionState): void {
  const unavailable = useElicitationStore((s) => s.unavailable);
  const busy = useElicitationStore((s) => s.inFlightCount > 0 && !s.unavailable);
  const idle = connectionState === "connected" && !unavailable;

  React.useEffect(() => {
    if (!busy && !idle) return;
    const poll = () => void useElicitationStore.getState().poll();
    if (!busy) poll();
    const timer = setInterval(poll, busy ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [busy, idle]);
}
