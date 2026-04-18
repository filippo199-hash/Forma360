/**
 * Root tRPC router.
 *
 * Each module gets its own router under `src/routers/` and is merged in
 * here as a namespace. Phase 0 ships only `health`; Phase 1 adds `tenants`,
 * `users`, `groups`, `sites`, `permissions`.
 */
import { healthRouter } from './routers/health';
import { router } from './trpc';

export const appRouter = router({
  health: healthRouter,
});

export type AppRouter = typeof appRouter;
