import { afterEach, describe, expect, it, vi } from "vitest";
import { useActivityStore } from "@/stores/activity-store";
import { useElicitationStore } from "@/stores/elicitation-store";
import { api } from "../api";
import { isUnbatchedPath, trpc } from "../trpc";

vi.mock("../trpc", async (importOriginal) => ({
  isUnbatchedPath: (await importOriginal<typeof import("../trpc")>()).isUnbatchedPath,
  trpc: {
    elicitations: {
      pending: { query: vi.fn() },
      respond: { mutate: vi.fn() },
    },
    servers: {
      callTool: { mutate: vi.fn() },
      readResource: { mutate: vi.fn() },
      getPrompt: { mutate: vi.fn() },
      complete: { mutate: vi.fn() },
      readSkill: { mutate: vi.fn() },
    },
  },
}));

afterEach(() => {
  vi.resetAllMocks();
  useActivityStore.getState().clear();
  useElicitationStore.setState(useElicitationStore.getInitialState());
});

describe("activity requests", () => {
  it.each([
    {
      method: "callTool" as const,
      kind: "tool-call",
      body: { name: "search", arguments: { query: "hello" } },
      secondBody: { name: "search", arguments: { query: "second" } },
    },
    {
      method: "readResource" as const,
      kind: "resource-read",
      body: { uri: "file:///example.txt" },
      secondBody: { uri: "file:///second.txt" },
    },
    {
      method: "getPrompt" as const,
      kind: "prompt-get",
      body: { name: "review", arguments: { language: "English" } },
      secondBody: { name: "review", arguments: { language: "French" } },
    },
    {
      method: "complete" as const,
      kind: "complete",
      body: { refType: "prompt" as const, ref: "review", argument: "language", value: "Eng", context: { tone: "brief" } },
      secondBody: { refType: "prompt" as const, ref: "review", argument: "language", value: "Fre", context: { tone: "formal" } },
    },
  ])("retains $method inputs for single and batched results", async ({ method, kind, body, secondBody }) => {
    const success = { kind, target: "same-target", outcome: "ok" as const, durationMs: 1, tokenCount: null, result: {} };
    const failure = { kind, target: "same-target", outcome: "error" as const, durationMs: 1, tokenCount: null, error: "Failed" };
    const mutate = vi.mocked(trpc.servers[method].mutate);
    mutate.mockResolvedValueOnce({ activities: [success] });

    const call = api[method] as (name: string, input: unknown) => Promise<unknown>;
    await call("server", body);
    expect(useActivityStore.getState().entries[0]).toMatchObject({ request: body, response: {} });

    mutate.mockResolvedValueOnce({ activities: [success, failure] });
    await call("server", [body, secondBody]);

    expect(useActivityStore.getState().entries.slice(0, 2)).toMatchObject([
      { request: body, outcome: "ok" },
      { request: secondBody, outcome: "error", error: "Failed" },
    ]);
  });

  it("retains both skill and resource URIs", async () => {
    vi.mocked(trpc.servers.readSkill.mutate).mockResolvedValue({
      activities: [{ kind: "skill-read", target: "file:///example.txt", outcome: "ok", durationMs: 1, tokenCount: null, result: {} }],
    });
    await api.readSkill("server", "skill://example", "file:///example.txt");
    expect(useActivityStore.getState().entries[0]?.request).toEqual({
      uri: "skill://example",
      resourceUri: "file:///example.txt",
    });
  });
});

describe("elicitation requests", () => {
  it.each(["callTool", "readResource", "getPrompt"] as const)(
    "%s raises the in-flight count and polls until it settles",
    async (method) => {
      vi.mocked(trpc.elicitations.pending.query).mockResolvedValue({ pending: [], completions: [] });
      let release!: (value: unknown) => void;
      vi.mocked(trpc.servers[method].mutate).mockImplementationOnce(
        () => new Promise((resolve) => (release = resolve)) as never,
      );
      const call = (api[method] as (name: string, body: unknown) => Promise<unknown>)("server", { name: "x" });
      expect(useElicitationStore.getState().inFlightCount).toBe(1);
      expect(trpc.elicitations.pending.query).toHaveBeenCalledOnce();
      release({ activities: [] });
      await call;
      expect(useElicitationStore.getState().inFlightCount).toBe(0);
    },
  );

  it("releases the in-flight count when the call fails", async () => {
    vi.mocked(trpc.elicitations.pending.query).mockResolvedValue({ pending: [], completions: [] });
    vi.mocked(trpc.servers.callTool.mutate).mockRejectedValueOnce(new Error("boom"));
    await expect(api.callTool("server", { name: "x" })).rejects.toThrow("boom");
    expect(useElicitationStore.getState().inFlightCount).toBe(0);
  });

  it("lists and answers elicitations through the elicitations router", async () => {
    vi.mocked(trpc.elicitations.pending.query).mockResolvedValue({ pending: [], completions: [] });
    await api.pendingElicitations();
    await api.pendingElicitations("server");
    expect(vi.mocked(trpc.elicitations.pending.query).mock.calls).toEqual([[undefined], [{ serverName: "server" }]]);

    vi.mocked(trpc.elicitations.respond.mutate).mockResolvedValue({} as never);
    await api.respondElicitation({ id: "a", action: "accept", content: { name: "Ada" } });
    expect(trpc.elicitations.respond.mutate).toHaveBeenCalledWith({ id: "a", action: "accept", content: { name: "Ada" } });
  });
});

describe("request batching", () => {
  it("sends long-running calls and elicitation traffic outside the batch link", () => {
    for (const path of [
      "elicitations.pending",
      "elicitations.respond",
      "servers.callTool",
      "servers.readResource",
      "servers.getPrompt",
      "servers.discover",
      "servers.listSkills",
      "servers.getSkill",
      "servers.readSkill",
      "servers.readSkillDirectory",
    ]) {
      expect(isUnbatchedPath(path)).toBe(true);
    }
    expect(isUnbatchedPath("servers.list")).toBe(false);
    expect(isUnbatchedPath("servers.complete")).toBe(false);
  });
});
