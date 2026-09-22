import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parseDocument } from "yaml";
import { z } from "zod";
import type { Client } from "@modelcontextprotocol/client";
import { isSkillFile, skillSchema, skillsCapability, type Skill } from "./skills.js";

const cacheFields = {
  ttlMs: z.number().int().nonnegative(),
  cacheScope: z.enum(["public", "private"]),
};
const listSchema = z.object({
  resultType: z.literal("complete").optional(),
  ...cacheFields,
  skills: z.array(skillSchema),
  nextCursor: z.string().optional(),
}).passthrough();
const getSchema = z.object({
  resultType: z.literal("complete").optional(),
  ...cacheFields,
  skill: skillSchema,
}).passthrough();
const directorySchema = z.object({
  resultType: z.literal("complete").optional(),
  resources: z.array(z.object({
    uri: z.string(), name: z.string(), mimeType: z.string().optional(),
    description: z.string().optional(), title: z.string().optional(),
  }).passthrough()),
  nextCursor: z.string().optional(),
}).passthrough();

function requireSkills(client: Client, directory = false) {
  const capability = skillsCapability(client.getServerCapabilities());
  if (!capability) throw new Error("Server does not advertise the Skills extension and resources capability");
  if (directory && capability.directoryRead !== true) {
    throw new Error("Server does not advertise Skills directoryRead support");
  }
}

export async function listSkills(client: Client) {
  requireSkills(client);
  const skills: Skill[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let ttlMs = Infinity;
  let cacheScope: "public" | "private" = "public";
  do {
    const page = await client.request({ method: "skills/list", params: cursor === undefined ? {} : { cursor } }, listSchema);
    skills.push(...page.skills);
    ttlMs = Math.min(ttlMs, page.ttlMs);
    if (page.cacheScope === "private") cacheScope = "private";
    cursor = page.nextCursor;
    if (cursor !== undefined) {
      if (seen.has(cursor)) throw new Error("Server repeated a skills/list pagination cursor");
      seen.add(cursor);
    }
  } while (cursor !== undefined);
  return { resultType: "complete" as const, skills, ttlMs, cacheScope };
}

export async function getSkill(client: Client, uri: string) {
  requireSkills(client);
  const result = await client.request({ method: "skills/get", params: { uri } }, getSchema);
  if (result.skill.uri !== uri) throw new Error("skills/get returned a different skill URI");
  return result;
}

export async function readSkillDirectory(client: Client, uri: string) {
  requireSkills(client, true);
  const resources: z.infer<typeof directorySchema>["resources"] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await client.request({
      method: "resources/directory/read", params: { uri, ...(cursor === undefined ? {} : { cursor }) },
    }, directorySchema);
    resources.push(...page.resources);
    cursor = page.nextCursor;
    if (cursor !== undefined) {
      if (seen.has(cursor)) throw new Error("Server repeated a directory pagination cursor");
      seen.add(cursor);
    }
  } while (cursor !== undefined);
  return { resultType: "complete" as const, resources };
}

function verifyContent(skill: Skill, uri: string, contents: Array<{ uri: string; text?: string; blob?: string }>) {
  if (contents.length !== 1 || contents[0]?.uri !== uri) {
    throw new Error("Resource response must contain exactly the requested file");
  }
  const content = contents[0];
  if ((typeof content.text === "string") === (typeof content.blob === "string")) {
    throw new Error("Resource must contain either text or a blob");
  }
  const bytes = typeof content.text === "string" ? Buffer.from(content.text, "utf8") : Buffer.from(content.blob!, "base64");
  if (bytes.length > 16 * 1024 * 1024) throw new Error("Skill file exceeds the 16 MiB limit");
  if (skill.resources !== "dynamic") {
    const entry = skill.resources.find((file) => file.uri === uri);
    if (!entry || entry.size !== bytes.length || entry.digest !== `sha256:${createHash("sha256").update(bytes).digest("hex")}`) {
      throw new Error("Skill file size or SHA-256 digest does not match its manifest");
    }
  }
  if (uri === skill.uri) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(bytes.toString("utf8"));
    if (!frontmatter) throw new Error("SKILL.md is missing YAML frontmatter");
    const document = parseDocument(frontmatter[1]!);
    if (document.errors.length || !isDeepStrictEqual(document.toJS({ maxAliasCount: 100 }), skill.frontmatter)) {
      throw new Error("SKILL.md frontmatter does not match the skill entry");
    }
  }
}

export async function readSkillFile(client: Client, skillUri: string, resourceUri = skillUri) {
  let { skill } = await getSkill(client, skillUri);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (!isSkillFile(skill.uri, resourceUri)) throw new Error("Requested file is outside the skill directory");
      if (skill.resources !== "dynamic") {
        if (skill.resources.length > 512 || skill.resources.reduce((size, file) => size + file.size, 0) > 16 * 1024 * 1024) {
          throw new Error("Skill exceeds the supported limit of 512 files or 16 MiB");
        }
        if (!skill.resources.some((file) => file.uri === resourceUri)) throw new Error("Requested file is not in the skill manifest");
      }
      const result = await client.readResource({ uri: resourceUri }, attempt === 0 ? undefined : { cacheMode: "refresh" });
      verifyContent(skill, resourceUri, result.contents);
      return { ...result, skill, verification: skill.resources === "dynamic" ? "dynamic" as const : "verified" as const };
    } catch (error) {
      if (attempt === 1) throw error;
      skill = (await getSkill(client, skillUri)).skill;
    }
  }
  throw new Error("Skill verification failed");
}
