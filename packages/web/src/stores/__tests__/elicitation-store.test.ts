// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PendingElicitation } from "@rolaca11/mcp-inspector-core/elicitation";

import { ApiError, api } from "@/data/api";
import { useActivityStore } from "@/stores/activity-store";
import type { ConnectionState } from "@/stores/connection-store";
import {
  ACTIVE_POLL_MS,
  FOLLOW_UP_POLL_MS,
  IDLE_POLL_MS,
  useElicitationPoller,
  useElicitationStore,
} from "@/stores/elicitation-store";

const form = (id: string, serverName = "server"): PendingElicitation => ({
  id,
  serverName,
  createdAt: "2026-11-25T10:00:00.000Z",
  params: {
    mode: "form",
    message: `Question ${id}`,
    requestedSchema: { type: "object", properties: { name: { type: "string" } } },
  },
});

let container: HTMLDivElement;
let root: Root;
let serverSide: PendingElicitation[];

function Poller({ state }: { state: ConnectionState }) {
  useElicitationPoller(state);
  return null;
}

async function mountPoller(state: ConnectionState) {
  await act(async () => root.render(createElement(Poller, { state })));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const polls = () => vi.mocked(api.pendingElicitations).mock.calls.length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  serverSide = [];
  vi.spyOn(api, "pendingElicitations").mockImplementation(async () => ({
    pending: [...serverSide],
    completions: [],
  }));
  vi.spyOn(api, "respondElicitation").mockImplementation(async ({ id, action, content }) => {
    const item = serverSide.find((p) => p.id === id)!;
    serverSide = serverSide.filter((p) => p.id !== id);
    return {
      ok: true,
      id,
      serverName: item.serverName,
      params: item.params,
      result: content ? { action, content } : { action },
      durationMs: 42,
    };
  });
  useActivityStore.getState().clear();
  useElicitationStore.setState(useElicitationStore.getInitialState());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("polling cadence", () => {
  it("polls every 1500ms while connected and idle", async () => {
    await mountPoller("connected");
    await advance(0);
    expect(polls()).toBe(1);
    await advance(IDLE_POLL_MS - 1);
    expect(polls()).toBe(1);
    await advance(1);
    expect(polls()).toBe(2);
    await advance(IDLE_POLL_MS * 2);
    expect(polls()).toBe(4);
  });

  it("polls immediately and every 200ms while an operation is in flight", async () => {
    await mountPoller("connected");
    await advance(0);
    const before = polls();

    await act(async () => useElicitationStore.getState().beginOperation());
    await advance(0);
    expect(polls()).toBe(before + 1);
    await advance(ACTIVE_POLL_MS * 5);
    expect(polls()).toBe(before + 6);

    await act(async () => useElicitationStore.getState().endOperation());
    await advance(0);
    const idleStart = polls();
    await advance(ACTIVE_POLL_MS * 5);
    expect(polls()).toBe(idleStart);
    await advance(IDLE_POLL_MS);
    expect(polls()).toBe(idleStart + 1);
  });

  it("stops polling when disconnected unless an operation is running", async () => {
    await mountPoller("disconnected");
    await advance(IDLE_POLL_MS * 4);
    expect(polls()).toBe(0);

    await act(async () => useElicitationStore.getState().beginOperation());
    await advance(ACTIVE_POLL_MS * 2);
    expect(polls()).toBe(3);

    await act(async () => useElicitationStore.getState().endOperation());
    await advance(IDLE_POLL_MS * 4);
    expect(polls()).toBe(3);
  });

  it("clears its timer on unmount", async () => {
    await mountPoller("connected");
    await advance(0);
    await act(async () => root.unmount());
    root = createRoot(container);
    const count = polls();
    await advance(IDLE_POLL_MS * 4);
    expect(polls()).toBe(count);
  });

  it("never goes below zero in-flight operations", () => {
    useElicitationStore.getState().endOperation();
    expect(useElicitationStore.getState().inFlightCount).toBe(0);
  });

  it("stops idle and busy polling when the server has elicitation disabled", async () => {
    vi.mocked(api.pendingElicitations).mockRejectedValue(
      new ApiError(412, "Elicitation is not enabled on this server", { code: "PRECONDITION_FAILED" }),
    );
    await mountPoller("connected");
    await advance(0);
    expect(useElicitationStore.getState().unavailable).toBe(true);
    await advance(IDLE_POLL_MS * 4);
    expect(polls()).toBe(1);

    await act(async () => useElicitationStore.getState().beginOperation());
    await advance(ACTIVE_POLL_MS * 3);
    expect(polls()).toBe(2); // 1 from beginOperation's initial poll, zero interval polls
    await act(async () => useElicitationStore.getState().endOperation());
  });
});

describe("poll", () => {
  it("loads pending elicitations for every server", async () => {
    serverSide = [form("a"), form("b", "other")];
    await useElicitationStore.getState().poll();
    expect(api.pendingElicitations).toHaveBeenCalledWith();
    expect(useElicitationStore.getState().pending.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("coalesces overlapping polls into one follow-up request", async () => {
    let release!: () => void;
    vi.mocked(api.pendingElicitations).mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ pending: [form("old")], completions: [] }))),
    );
    serverSide = [form("new")];
    const store = useElicitationStore.getState();
    const first = store.poll();
    void store.poll();
    void store.poll();
    expect(polls()).toBe(1);
    release();
    await first;
    expect(polls()).toBe(2);
    expect(useElicitationStore.getState().pending.map((p) => p.id)).toEqual(["new"]);
  });

  it("discards a poll response that started before an answer was sent", async () => {
    serverSide = [form("a")];
    useElicitationStore.setState({ pending: [form("a")] });
    let release!: () => void;
    vi.mocked(api.pendingElicitations).mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ pending: [form("a")], completions: [] }))),
    );
    const polling = useElicitationStore.getState().poll();
    await useElicitationStore.getState().respond("a", "decline");
    release();
    await polling;
    expect(useElicitationStore.getState().pending).toEqual([]);
  });

  it("drops drafts that are no longer pending", async () => {
    const draft = { values: { name: "Ada" }, touched: { name: true }, submitted: false };
    useElicitationStore.setState({
      pending: [form("a"), form("b")],
      drafts: { a: draft, b: draft },
    });
    serverSide = [form("b")];
    await useElicitationStore.getState().poll();
    expect(useElicitationStore.getState().drafts).toEqual({ b: draft });
  });
});

describe("respond", () => {
  it("logs the answer, removes it from the queue and clears its draft", async () => {
    const draft = { values: { name: "Ada" }, touched: { name: true }, submitted: false };
    serverSide = [form("a"), form("b")];
    useElicitationStore.setState({ pending: [form("a"), form("b")], drafts: { a: draft } });

    const ok = await useElicitationStore.getState().respond("a", "accept", { name: "Ada" });

    expect(ok).toBe(true);
    expect(api.respondElicitation).toHaveBeenCalledExactlyOnceWith({
      id: "a",
      action: "accept",
      content: { name: "Ada" },
    });
    const state = useElicitationStore.getState();
    expect(state.pending.map((p) => p.id)).toEqual(["b"]);
    expect(state.drafts).toEqual({});
    expect(state.submittingId).toBeNull();
    expect(useActivityStore.getState().entries[0]).toMatchObject({
      kind: "elicitation",
      serverName: "server",
      target: "form: Question a",
      outcome: "ok",
      durationMs: 42,
      request: form("a").params,
      response: { action: "accept", content: { name: "Ada" } },
    });

    serverSide.push(form("c"));
    expect(polls()).toBe(0);
    await advance(FOLLOW_UP_POLL_MS - 1);
    expect(polls()).toBe(0);
    await advance(1);
    expect(polls()).toBe(1);
    expect(useElicitationStore.getState().pending.map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("omits content when none is given", async () => {
    serverSide = [form("a")];
    await useElicitationStore.getState().respond("a", "cancel");
    expect(api.respondElicitation).toHaveBeenCalledExactlyOnceWith({ id: "a", action: "cancel" });
  });

  it("keeps the item and records the error when the server rejects the answer", async () => {
    useElicitationStore.setState({ pending: [form("a")] });
    vi.mocked(api.respondElicitation).mockRejectedValueOnce(
      new ApiError(400, "name: This field is required", { code: "BAD_REQUEST" }),
    );

    const ok = await useElicitationStore.getState().respond("a", "accept", {});

    expect(ok).toBe(false);
    const state = useElicitationStore.getState();
    expect(state.pending.map((p) => p.id)).toEqual(["a"]);
    expect(state.submitError).toBe("name: This field is required");
    expect(state.submitErrorId).toBe("a");
    expect(state.submittingId).toBeNull();
    expect(useActivityStore.getState().entries).toEqual([]);
  });

  it("refreshes the queue when the elicitation no longer exists", async () => {
    useElicitationStore.setState({ pending: [form("gone")] });
    vi.mocked(api.respondElicitation).mockRejectedValueOnce(
      new ApiError(404, "No pending elicitation with id gone", { code: "NOT_FOUND" }),
    );

    await useElicitationStore.getState().respond("gone", "decline");
    await advance(0);

    const state = useElicitationStore.getState();
    expect(polls()).toBe(1);
    expect(state.pending).toEqual([]);
    expect(state.submitError).toBeNull();
  });
});

describe("drafts", () => {
  it("stores form drafts per elicitation id and preserves them across polls while pending", async () => {
    const store = useElicitationStore.getState();
    const draftA = { values: { name: "Grace" }, touched: { name: true }, submitted: false };
    const draftB = { values: { name: "Lin" }, touched: {}, submitted: false };
    store.setDraft("a", draftA);
    store.setDraft("b", draftB);
    expect(useElicitationStore.getState().drafts).toEqual({ a: draftA, b: draftB });

    serverSide = [form("a")];
    await useElicitationStore.getState().poll();
    expect(useElicitationStore.getState().drafts).toEqual({ a: draftA });
  });
});
