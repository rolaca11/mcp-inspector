import { router } from "./trpc.js";
import { healthRouter } from "./routers/health.js";
import { serversRouter } from "./routers/servers.js";
import { configRouter } from "./routers/config.js";
import { savedFormsRouter } from "./routers/saved-forms.js";
import { elicitationsRouter } from "./routers/elicitations.js";

export const appRouter = router({
  health: healthRouter,
  servers: serversRouter,
  config: configRouter,
  savedForms: savedFormsRouter,
  elicitations: elicitationsRouter,
});

export type AppRouter = typeof appRouter;
