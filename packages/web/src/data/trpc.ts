import { createTRPCClient, httpBatchLink, httpLink, splitLink } from "@trpc/client";

import type { AppRouter } from "@rolaca11/mcp-inspector-core/trpc/router";

const UNBATCHED_PATHS = new Set([
  "servers.callTool",
  "servers.readResource",
  "servers.getPrompt",
  "servers.discover",
  "servers.listSkills",
  "servers.getSkill",
  "servers.readSkill",
  "servers.readSkillDirectory",
]);

export function isUnbatchedPath(path: string): boolean {
  return path.startsWith("elicitations.") || UNBATCHED_PATHS.has(path);
}

const url = "/api/trpc";

export const trpc = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => isUnbatchedPath(op.path),
      true: httpLink({ url }),
      false: httpBatchLink({ url }),
    }),
  ],
});
