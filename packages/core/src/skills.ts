import { z } from "zod";

export const SKILLS_EXTENSION = "io.modelcontextprotocol/skills";

export function skillsCapability(capabilities: unknown): { directoryRead?: boolean } | undefined {
  const parsed = z.object({
    resources: z.object({}).passthrough(),
    extensions: z.record(z.string(), z.unknown()),
  }).safeParse(capabilities);
  if (!parsed.success) return undefined;
  const extension = z.object({ directoryRead: z.boolean().optional() })
    .safeParse(parsed.data.extensions[SKILLS_EXTENSION]);
  return extension.success ? extension.data : undefined;
}

export function isSkillFile(skillUri: string, uri: string): boolean {
  if (!skillUri.endsWith("/SKILL.md")) return false;
  const root = skillUri.slice(0, -"SKILL.md".length);
  if (!uri.startsWith(root)) return false;
  try {
    const path = decodeURIComponent(uri.slice(root.length));
    return path.length > 0 && !/[\\?#]/.test(path) &&
      path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
  } catch {
    return false;
  }
}

export const skillSchema = z.object({
  uri: z.string().min(1),
  frontmatter: z.object({ name: z.string().min(1), description: z.string().min(1) }).passthrough(),
  resources: z.union([
    z.literal("dynamic"),
    z.array(z.object({
      uri: z.string().min(1),
      digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      size: z.number().int().nonnegative(),
    }).passthrough()),
  ]),
}).passthrough().superRefine((skill, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  try {
    new URL(skill.uri);
    const segments = skill.uri.split("/");
    if (!skill.uri.endsWith("/SKILL.md") || decodeURIComponent(segments.at(-2)!) !== skill.frontmatter.name) {
      fail("Skill URI must end with /<name>/SKILL.md");
    }
  } catch {
    fail("Invalid skill URI");
  }
  if (skill.resources === "dynamic") return;
  const uris = new Set(skill.resources.map((resource) => resource.uri));
  if (!uris.has(skill.uri)) fail("Skill manifest must include SKILL.md");
  if (uris.size !== skill.resources.length) fail("Duplicate resource URI in skill manifest");
  if (skill.resources.some((resource) => !isSkillFile(skill.uri, resource.uri))) {
    fail("Skill manifest contains a file outside the skill directory");
  }
});

export type Skill = z.infer<typeof skillSchema>;
