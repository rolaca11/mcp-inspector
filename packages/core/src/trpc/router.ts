import { router } from "./trpc.js";
import { healthRouter } from "./routers/health.js";
import { serversRouter } from "./routers/servers.js";
import { configRouter } from "./routers/config.js";

export const appRouter = router({
  health: healthRouter,
  servers: serversRouter,
  config: configRouter,
});

export type AppRouter = typeof appRouter;
