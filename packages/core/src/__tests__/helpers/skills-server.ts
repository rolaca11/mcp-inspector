import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { SKILLS_EXTENSION, type Skill } from "../../skills.js";

export const skillText = "---\nname: review\ndescription: Review a pull request\nlicense: MIT\n---\n# Review\n\nRead references/checklist.md before reviewing.\n";
export const skillUri = "skill://team/review/SKILL.md";
export const checklistUri = "skill://team/review/references/checklist.md";
export const checklistText = "Check error handling and test coverage.\n";
export const binaryUri = "skill://team/review/assets/sample.bin";
export const binaryBytes = Buffer.from([0, 1, 127, 128, 255]);

export function manifest(uri: string, content: string | Buffer) {
  const bytes = Buffer.from(content);
  return { uri, size: bytes.length, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
}

export const sampleSkill: Skill = {
  uri: skillUri,
  frontmatter: { name: "review", description: "Review a pull request", license: "MIT" },
  resources: [manifest(skillUri, skillText), manifest(checklistUri, checklistText), manifest(binaryUri, binaryBytes)],
};

export function configureSkillsServer(server: McpServer) {
  server.server.registerCapabilities({ extensions: { [SKILLS_EXTENSION]: { directoryRead: true } } });
  for (const [uri, text] of [[skillUri, skillText], [checklistUri, checklistText]]) {
    server.registerResource(uri!, uri!, { mimeType: "text/markdown" }, async () => ({
      contents: [{ uri: uri!, text: text! }],
    }));
  }
  server.registerResource("binary", binaryUri, { mimeType: "application/octet-stream" }, async () => ({
    contents: [{ uri: binaryUri, blob: binaryBytes.toString("base64") }],
  }));
  server.server.setRequestHandler("skills/list", {
    params: z.object({ cursor: z.string().optional() }),
  }, async ({ cursor }) => ({
    resultType: "complete", ttlMs: 300000, cacheScope: "private",
    skills: cursor === undefined ? [sampleSkill] : [{ ...sampleSkill, uri: "skill://other/review/SKILL.md", resources: "dynamic" }],
    ...(cursor === undefined ? { nextCursor: "next" } : {}),
  }));
  server.server.setRequestHandler("skills/get", { params: z.object({ uri: z.string() }) }, async ({ uri }) => ({
    resultType: "complete", ttlMs: 300000, cacheScope: "private",
    skill: uri === skillUri ? sampleSkill : { ...sampleSkill, uri, resources: "dynamic" },
  }));
  server.server.setRequestHandler("resources/directory/read", {
    params: z.object({ uri: z.string(), cursor: z.string().optional() }),
  }, async ({ uri, cursor }) => ({
    resultType: "complete",
    resources: uri.endsWith("/references") ? [{ uri: checklistUri, name: "checklist.md", mimeType: "text/markdown" }]
      : cursor === undefined ? [{ uri: skillUri, name: "SKILL.md", mimeType: "text/markdown" }]
        : [{ uri: "skill://team/review/references", name: "references", mimeType: "inode/directory" }],
    ...(cursor === undefined && !uri.endsWith("/references") ? { nextCursor: "next" } : {}),
  }));
}
