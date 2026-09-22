import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/client";
import { connect, type Session } from "../client.js";
import { getSkill, listSkills, readSkillDirectory, readSkillFile } from "../skill-client.js";
import { isSkillFile, SKILLS_EXTENSION, skillSchema, skillsCapability } from "../skills.js";
import { createSessionPool, type SessionPool } from "../session-pool.js";
import { appRouter } from "../trpc/router.js";
import { createCallerFactory } from "../trpc/trpc.js";
import { startStatelessServer } from "./helpers/stateless-server.js";
import { binaryUri, checklistUri, configureSkillsServer, manifest, sampleSkill, skillText, skillUri } from "./helpers/skills-server.js";

describe("Skills extension", () => {
  let server: Awaited<ReturnType<typeof startStatelessServer>> | undefined;
  let session: Session | undefined;
  let pool: SessionPool | undefined;

  afterEach(async () => {
    await session?.close();
    await pool?.closeAll();
    await server?.close();
    session = undefined;
    pool = undefined;
    server = undefined;
  });

  it.each(["json", "sse"] as const)("lists, gets, browses and verifies files over %s with request metadata", async (responseMode) => {
    server = await startStatelessServer({ responseMode, configure: configureSkillsServer });
    session = await connect(server.url, { quiet: true });
    const result = await listSkills(session.client);
    expect(result.skills.map((skill) => skill.frontmatter.name)).toEqual(["review", "review"]);
    expect(result).toMatchObject({ ttlMs: 300000, cacheScope: "private" });
    expect(server.log.some(({ body }) => body.method === "resources/read")).toBe(false);
    expect((await getSkill(session.client, "skill://unlisted/review/SKILL.md")).skill.resources).toBe("dynamic");
    expect((await readSkillDirectory(session.client, "skill://team/review")).resources).toHaveLength(2);
    expect(await readSkillFile(session.client, skillUri)).toMatchObject({ verification: "verified", contents: [{ text: skillText }] });
    expect((await readSkillFile(session.client, skillUri, checklistUri)).verification).toBe("verified");
    expect((await readSkillFile(session.client, skillUri, binaryUri)).verification).toBe("verified");
    for (const { body, headers } of server.log.filter(({ body }) => ["skills/list", "skills/get", "resources/directory/read"].includes(body.method))) {
      expect(body.params?._meta).toMatchObject({ "io.modelcontextprotocol/protocolVersion": "2026-07-28" });
      expect(headers.get("mcp-method")).toBe(body.method);
    }
  });

  it("exposes discovery and skill operations through tRPC with activity errors", async () => {
    server = await startStatelessServer({ configure: configureSkillsServer });
    pool = createSessionPool();
    const caller = createCallerFactory(appRouter)({ sessions: pool, configOpts: {}, pendingAuthUrls: new Map() });
    const input = { serverName: server.url };
    const discover = await caller.servers.discover(input);
    expect(discover.activities.find((activity) => activity.target === "skills")).toMatchObject({ outcome: "ok", result: expect.any(Array) });
    expect((await caller.servers.listSkills(input)).activities[0]).toMatchObject({ kind: "skill-list", outcome: "ok" });
    expect((await caller.servers.getSkill({ ...input, uri: skillUri })).activities[0]).toMatchObject({ kind: "skill-get", outcome: "ok" });
    expect((await caller.servers.readSkill({ ...input, uri: skillUri })).activities[0]).toMatchObject({ kind: "skill-read", outcome: "ok", result: { verification: "verified" } });
    expect((await caller.servers.readSkillDirectory({ ...input, uri: "skill://team/review" })).activities[0]?.outcome).toBe("ok");
    expect((await caller.servers.readSkill({ ...input, uri: skillUri, resourceUri: "file:///etc/passwd" })).activities[0]?.outcome).toBe("error");
  });

  it("does not call extension methods on unsupported servers", async () => {
    server = await startStatelessServer();
    session = await connect(server.url, { quiet: true });
    await expect(listSkills(session.client)).rejects.toThrow("does not advertise");
    await expect(getSkill(session.client, skillUri)).rejects.toThrow("does not advertise");
    await expect(readSkillDirectory(session.client, "skill://team/review")).rejects.toThrow("does not advertise");
    expect(server.log.map(({ body }) => body.method)).toEqual(["server/discover"]);
  });
});

function mockClient() {
  const request = vi.fn(async (_request: unknown, schema: { parse(value: unknown): unknown }) => schema.parse({
    resultType: "complete", ttlMs: 0, cacheScope: "private", skill: sampleSkill,
  }));
  const readResource = vi.fn(async () => ({ contents: [{ uri: skillUri, text: skillText }] }));
  const client = {
    getServerCapabilities: () => ({ resources: {}, extensions: { [SKILLS_EXTENSION]: {} } }),
    request, readResource,
  } as unknown as Client;
  return { client, request, readResource };
}

describe("Skill validation", () => {
  it("requires the extension and resources capabilities", () => {
    expect(skillsCapability({ resources: {} })).toBeUndefined();
    expect(skillsCapability({ extensions: { [SKILLS_EXTENSION]: {} } })).toBeUndefined();
    expect(skillsCapability({ resources: {}, extensions: { [SKILLS_EXTENSION]: {} } })).toEqual({});
  });

  it("gates directory reads separately", async () => {
    const { client, request } = mockClient();
    await expect(readSkillDirectory(client, "skill://team/review")).rejects.toThrow("directoryRead");
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["../secret", "%2e%2e/secret", "references/%2f../secret", "references\\secret", "file?query", "file#fragment"])("rejects invalid manifest path %s", (path) => {
    expect(isSkillFile(skillUri, `skill://team/review/${path}`)).toBe(false);
  });

  it("accepts nested files and alternate URI schemes", () => {
    expect(isSkillFile(skillUri, "skill://team/review/nested/other/SKILL.md")).toBe(true);
    expect(skillSchema.safeParse({ ...sampleSkill, uri: "github://org/repo/review/SKILL.md", resources: "dynamic" }).success).toBe(true);
  });

  it.each([
    { resources: undefined },
    { resources: [] },
    { resources: [manifest(skillUri, skillText), manifest(skillUri, skillText)] },
    { resources: [manifest(skillUri, skillText), manifest("skill://elsewhere/secret", "secret")] },
    { frontmatter: { name: "different", description: "wrong" } },
  ])("rejects invalid entries: %j", (override) => {
    expect(skillSchema.safeParse({ ...sampleSkill, ...override }).success).toBe(false);
  });

  it("refreshes stale metadata and reads again before returning content", async () => {
    const { client, request, readResource } = mockClient();
    readResource.mockResolvedValueOnce({ contents: [{ uri: skillUri, text: "stale" }] });
    expect((await readSkillFile(client, skillUri)).verification).toBe("verified");
    expect(request).toHaveBeenCalledTimes(2);
    expect(readResource).toHaveBeenCalledTimes(2);
  });

  it("rejects changed file bytes after a bounded retry", async () => {
    const { client, request, readResource } = mockClient();
    readResource.mockResolvedValue({ contents: [{ uri: skillUri, text: "tampered" }] });
    await expect(readSkillFile(client, skillUri)).rejects.toThrow("digest");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects matching digests when frontmatter differs", async () => {
    const { client, request } = mockClient();
    request.mockImplementation(async (_request, schema) => schema.parse({
      resultType: "complete", ttlMs: 0, cacheScope: "private",
      skill: { ...sampleSkill, frontmatter: { ...sampleSkill.frontmatter, license: "different" } },
    }));
    await expect(readSkillFile(client, skillUri)).rejects.toThrow("frontmatter");
  });

  it("labels dynamic content without claiming digest verification", async () => {
    const { client, request } = mockClient();
    request.mockImplementation(async (_request, schema) => schema.parse({
      resultType: "complete", ttlMs: 0, cacheScope: "private", skill: { ...sampleSkill, resources: "dynamic" },
    }));
    expect((await readSkillFile(client, skillUri)).verification).toBe("dynamic");
  });

  it("rejects files absent from the manifest without reading them", async () => {
    const { client, readResource } = mockClient();
    await expect(readSkillFile(client, skillUri, "skill://team/review/secret")).rejects.toThrow("manifest");
    expect(readResource).not.toHaveBeenCalled();
  });

  it("rejects repeated pagination cursors", async () => {
    const { client, request } = mockClient();
    request.mockImplementation(async (_request, schema) => schema.parse({
      resultType: "complete", ttlMs: 0, cacheScope: "private", skills: [sampleSkill], nextCursor: "same",
    }));
    await expect(listSkills(client)).rejects.toThrow("repeated");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
