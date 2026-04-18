/**
 * Root tRPC router.
 *
 * Each module gets its own router under `src/routers/` and is merged in
 * here as a namespace. Phase 0 shipped `health`; Phase 1 adds every admin
 * surface for the organisational backbone.
 */
import { accessRulesRouter } from './routers/accessRules';
import { customFieldsRouter } from './routers/customFields';
import { groupsRouter } from './routers/groups';
import { healthRouter } from './routers/health';
import { permissionsRouter } from './routers/permissions';
import { sitesRouter } from './routers/sites';
import { usersRouter } from './routers/users';
import { router } from './trpc';

export const appRouter = router({
  health: healthRouter,
  permissions: permissionsRouter,
  users: usersRouter,
  customFields: customFieldsRouter,
  groups: groupsRouter,
  sites: sitesRouter,
  accessRules: accessRulesRouter,
});

export type AppRouter = typeof appRouter;
