import { createTRPCClient, httpBatchLink } from "@trpc/client";

import type { AppRouter } from "@rolaca11/mcp-inspector-core/trpc/router";

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
    }),
  ],
});
