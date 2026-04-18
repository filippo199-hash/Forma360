/**
 * Root tRPC router.
 *
 * Each module gets its own router under `src/routers/` and is merged in
 * here as a namespace. Phase 0 shipped `health`; Phase 1 adds
 * `permissions`, `users`, `customFields`. Later Phase 1 PRs add
 * `groups`, `sites`, `accessRules`.
 */
import { customFieldsRouter } from './routers/customFields';
import { healthRouter } from './routers/health';
import { permissionsRouter } from './routers/permissions';
import { usersRouter } from './routers/users';
import { router } from './trpc';

export const appRouter = router({
  health: healthRouter,
  permissions: permissionsRouter,
  users: usersRouter,
  customFields: customFieldsRouter,
});

export type AppRouter = typeof appRouter;
