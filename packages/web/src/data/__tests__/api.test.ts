import { afterEach, describe, expect, it, vi } from "vitest";
import { useActivityStore } from "@/stores/activity-store";
import { api } from "../api";
import { trpc } from "../trpc";

vi.mock("../trpc", () => ({
  trpc: {
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
