import { createTRPCClient, httpBatchLink } from "@trpc/client";

import type { AppRouter } from "../../trpc/router.js";

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
    }),
  ],
});
