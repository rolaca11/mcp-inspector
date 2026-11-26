import { randomUUID } from "node:crypto";

import type {
  ElicitationCompletionEvent,
  ElicitationHandlerContext,
  ElicitationRequestParams,
  ElicitationResult,
  PendingElicitation,
} from "./elicitation.js";

const MAX_ELICITATION_COMPLETIONS = 50;

interface ElicitationResponse {
  ok: true;
  id: string;
  serverName: string;
  params: ElicitationRequestParams;
  result: ElicitationResult;
  durationMs: number;
}

export interface ElicitationBroker {
  request(
    serverName: string,
    params: ElicitationRequestParams,
    ctx?: ElicitationHandlerContext,
  ): Promise<ElicitationResult>;
  list(serverName?: string): {
    pending: PendingElicitation[];
    completions: ElicitationCompletionEvent[];
  };
  get(id: string): PendingElicitation | undefined;
  respond(id: string, result: ElicitationResult): ElicitationResponse;
  recordCompletion(serverName: string, elicitationId: string): void;
  hasPending(serverName: string): boolean;
  cancelForServer(serverName: string, reason?: string): void;
  cancelAll(reason?: string): void;
}

class ElicitationCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ElicitationCancelledError";
  }
}

interface Entry {
  pending: PendingElicitation;
  startedAt: number;
  resolve(result: ElicitationResult): void;
  reject(error: unknown): void;
}

export function createElicitationBroker(): ElicitationBroker {
  const entries = new Map<string, Entry>();
  const completions: ElicitationCompletionEvent[] = [];

  function rejectEntry(id: string, error: unknown): void {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id);
    entry.reject(error);
  }

  function request(
    serverName: string,
    params: ElicitationRequestParams,
    ctx: ElicitationHandlerContext = {},
  ): Promise<ElicitationResult> {
    const signal = ctx.signal;
    const abortReason = () => signal?.reason ?? new ElicitationCancelledError("Elicitation was cancelled");
    if (signal?.aborted) return Promise.reject(abortReason());
    const id = randomUUID();
    return new Promise<ElicitationResult>((resolve, reject) => {
      const onAbort = () => rejectEntry(id, abortReason());
      const settle =
        <T>(fn: (value: T) => void) =>
        (value: T) => {
          signal?.removeEventListener("abort", onAbort);
          fn(value);
        };
      entries.set(id, {
        pending: { id, serverName, createdAt: new Date().toISOString(), params },
        startedAt: Date.now(),
        resolve: settle(resolve),
        reject: settle(reject),
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  function list(serverName?: string) {
    const match = (name: string) => serverName === undefined || name === serverName;
    return {
      pending: Array.from(entries.values())
        .filter((e) => match(e.pending.serverName))
        .map((e) => e.pending),
      completions: completions.filter((c) => match(c.serverName)),
    };
  }

  function get(id: string): PendingElicitation | undefined {
    return entries.get(id)?.pending;
  }

  function respond(id: string, result: ElicitationResult): ElicitationResponse {
    const entry = entries.get(id);
    if (!entry) throw new Error(`No pending elicitation with id ${id}; it may have expired or been cancelled`);
    entries.delete(id);
    entry.resolve(result);
    return {
      ok: true,
      id,
      serverName: entry.pending.serverName,
      params: entry.pending.params,
      result,
      durationMs: Date.now() - entry.startedAt,
    };
  }

  function recordCompletion(serverName: string, elicitationId: string): void {
    completions.push({ serverName, elicitationId, completedAt: new Date().toISOString() });
    if (completions.length > MAX_ELICITATION_COMPLETIONS) {
      completions.splice(0, completions.length - MAX_ELICITATION_COMPLETIONS);
    }
  }

  function hasPending(serverName: string): boolean {
    return Array.from(entries.values()).some((e) => e.pending.serverName === serverName);
  }

  function cancelForServer(serverName: string, reason = "Elicitation was cancelled"): void {
    for (const [id, entry] of Array.from(entries)) {
      if (entry.pending.serverName === serverName) {
        rejectEntry(id, new ElicitationCancelledError(reason));
      }
    }
  }

  function cancelAll(reason = "Elicitation was cancelled"): void {
    for (const id of Array.from(entries.keys())) {
      rejectEntry(id, new ElicitationCancelledError(reason));
    }
  }

  return {
    request,
    list,
    get,
    respond,
    recordCompletion,
    hasPending,
    cancelForServer,
    cancelAll,
  };
}
