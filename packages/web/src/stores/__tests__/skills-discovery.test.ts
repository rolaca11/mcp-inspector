import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/data/api";
import type { ActivityResult, MCPServer } from "@/data/types";
import { useConnectionStore } from "../connection-store";

vi.mock("@/data/api", () => ({
  ApiError: class ApiError extends Error {},
  api: { discover: vi.fn(), disconnect: vi.fn(), authUrl: vi.fn() },
}));

const server: MCPServer = {
  id: "first", name: "first", source: "/test/mcp.json", sourceLabel: "project",
  transport: "http", target: "http://localhost/mcp",
};
const skill = {
  uri: "skill://review/SKILL.md",
  frontmatter: { name: "review", description: "Review changes" },
  resources: "dynamic" as const,
};
const activity = (target: string, result: unknown): ActivityResult => ({
  kind: "discover", target, result, outcome: "ok", durationMs: 0, tokenCount: null,
});

afterEach(() => {
  vi.resetAllMocks();
  useConnectionStore.setState({ server: null, data: null, loading: false, connectionState: "idle" });
});

describe("skill discovery state", () => {
  it("records skills from connection discovery", async () => {
    useConnectionStore.setState({ server });
    vi.mocked(api.discover).mockResolvedValue([
      activity("connect", { server: { name: "test" }, capabilities: { resources: {} } }),
      activity("skills", [skill]),
    ]);
    await useConnectionStore.getState().rediscover();
    expect(useConnectionStore.getState()).toMatchObject({ connectionState: "connected", data: { skills: [skill] } });
  });

  it("clears skills on disconnect", async () => {
    useConnectionStore.setState({ server });
    vi.mocked(api.discover).mockResolvedValue([
      activity("connect", { server: null, capabilities: {} }), activity("skills", [skill]),
    ]);
    await useConnectionStore.getState().rediscover();
    await useConnectionStore.getState().disconnect();
    expect(useConnectionStore.getState()).toMatchObject({ data: null, connectionState: "disconnected" });
  });

  it("does not replace a new server's skills with an old response", async () => {
    let resolveFirst!: (value: ActivityResult[]) => void;
    vi.mocked(api.discover)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce([activity("connect", { server: null, capabilities: {} }), activity("skills", [])]);
    useConnectionStore.getState().setServer(server);
    useConnectionStore.getState().setServer({ ...server, id: "second" });
    await vi.waitFor(() => expect(useConnectionStore.getState().connectionState).toBe("connected"));
    resolveFirst([activity("connect", { server: null, capabilities: {} }), activity("skills", [skill])]);
    await Promise.resolve();
    expect(useConnectionStore.getState()).toMatchObject({ server: { id: "second" }, data: { skills: [] } });
  });
});
