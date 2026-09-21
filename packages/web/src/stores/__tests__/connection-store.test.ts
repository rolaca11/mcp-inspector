import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityResult, MCPServer } from "@/data/types";
import { trpc } from "@/data/trpc";
import { useActivityStore } from "../activity-store";
import { useConnectionStore } from "../connection-store";

vi.mock("@/data/trpc", () => ({
  trpc: {
    servers: {
      discover: { mutate: vi.fn() },
    },
  },
}));

const server: MCPServer = {
  id: "test-server",
  name: "test-server",
  source: "/tmp/mcp.json",
  sourceLabel: "project",
  transport: "http",
  target: "http://localhost/mcp",
};

function activity(target: string, result: unknown): ActivityResult {
  return {
    kind: "discover",
    target,
    outcome: "ok",
    durationMs: 1,
    tokenCount: null,
    result,
  };
}

describe("connection discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useActivityStore.getState().clear();
    useConnectionStore.setState({ ...useConnectionStore.getInitialState(), server });
  });

  it("connects and loads primitives from discovery activities", async () => {
    const serverInfo = { name: "test-server", version: "1.0.0" };
    const capabilities = { tools: {}, resources: {}, prompts: {} };
    const tools = [{ name: "echo", inputSchema: { type: "object" } }];
    const resources = [{ name: "example", uri: "test://example" }];
    const resourceTemplates = [{ name: "item", uriTemplate: "test://{id}" }];
    const prompts = [{ name: "greet" }];
    vi.mocked(trpc.servers.discover.mutate).mockResolvedValue({
      activities: [
        activity("connect", { server: serverInfo, capabilities }),
        activity("tools", tools),
        activity("resources", resources),
        activity("templates", resourceTemplates),
        activity("prompts", prompts),
      ],
    });

    await useConnectionStore.getState().rediscover();

    expect(useConnectionStore.getState()).toMatchObject({
      connectionState: "connected",
      loading: false,
      error: undefined,
      pendingAuthUrl: null,
      lastDiscoveredAt: expect.any(String),
      data: { server: serverInfo, capabilities, tools, resources, resourceTemplates, prompts },
    });
  });

  it("shows the connection error returned by the server", async () => {
    vi.mocked(trpc.servers.discover.mutate).mockResolvedValue({
      activities: [{
        ...activity("connect", undefined),
        outcome: "error",
        error: "Connection refused",
      }],
    });

    await useConnectionStore.getState().rediscover();

    expect(useConnectionStore.getState()).toMatchObject({
      connectionState: "error",
      error: "Connection refused",
      data: null,
      loading: false,
      pendingAuthUrl: null,
    });
  });

  it("reports discovery failure when the connection activity is missing", async () => {
    vi.mocked(trpc.servers.discover.mutate).mockResolvedValue({ activities: [] });

    await useConnectionStore.getState().rediscover();

    expect(useConnectionStore.getState()).toMatchObject({
      connectionState: "error",
      error: "discover failed",
      data: null,
      loading: false,
    });
  });
});
