import { afterEach, describe, expect, it, vi } from "vitest";

import { api, type ServersListResponse } from "@/data/api";
import { useServersStore } from "@/stores/servers-store";

afterEach(() => {
  vi.restoreAllMocks();
  useServersStore.setState({
    servers: [],
    sources: [],
    apiState: "loading",
    error: undefined,
  });
});

const response: ServersListResponse = {
  errors: [],
  sources: [
    { path: "/inspector/mcp.json", label: "inspector", serverCount: 1 },
    { path: "/home/.mcp.json", label: "global", serverCount: 1 },
    { path: "/project/.mcp.json", label: "project", serverCount: 2 },
  ],
  servers: [
    { id: "inspector", name: "inspector", source: "/inspector/mcp.json", sourceLabel: "inspector", transport: "stdio", target: "inspector" },
    { id: "global", name: "global", source: "/home/.mcp.json", sourceLabel: "global", transport: "stdio", target: "global" },
    { id: "project-a", name: "project-a", source: "/project/.mcp.json", sourceLabel: "project", transport: "stdio", target: "project-a" },
    { id: "project-b", name: "project-b", source: "/project/.mcp.json", sourceLabel: "project", transport: "stdio", target: "project-b" },
  ],
};

describe("fetchServers", () => {
  it("puts project servers and their source first without changing order within a source", async () => {
    vi.spyOn(api, "servers").mockResolvedValue(response);

    await useServersStore.getState().fetchServers();

    expect(useServersStore.getState().servers.map((server) => server.id)).toEqual([
      "project-a",
      "project-b",
      "inspector",
      "global",
    ]);
    expect(useServersStore.getState().sources.map((source) => source.label)).toEqual([
      "project",
      "inspector",
      "global",
    ]);
  });

  it("keeps the original order when the project source has no servers", async () => {
    vi.spyOn(api, "servers").mockResolvedValue({
      ...response,
      sources: response.sources.map((source) =>
        source.label === "project" ? { ...source, serverCount: 0 } : source,
      ),
      servers: response.servers.filter((server) => server.sourceLabel !== "project"),
    });

    await useServersStore.getState().fetchServers();

    expect(useServersStore.getState().servers.map((server) => server.id)).toEqual([
      "inspector",
      "global",
    ]);
    expect(useServersStore.getState().sources.map((source) => source.label)).toEqual([
      "inspector",
      "global",
      "project",
    ]);
  });
});
