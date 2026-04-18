/**
 * Root tRPC router.
 *
 * Each module gets its own router under `src/routers/` and is merged in
 * here as a namespace. Phase 0: `health`. Phase 1: the org-backbone
 * surface. Phase 2 adds `templates` + `globalResponseSets` so far;
 * `inspections`, `signatures`, `approvals`, `schedules`, `actions` land
 * in PR 28+.
 */
import { accessRulesRouter } from './routers/accessRules';
import { customFieldsRouter } from './routers/customFields';
import { globalResponseSetsRouter } from './routers/globalResponseSets';
import { groupsRouter } from './routers/groups';
import { healthRouter } from './routers/health';
import { permissionsRouter } from './routers/permissions';
import { sitesRouter } from './routers/sites';
import { templatesRouter } from './routers/templates';
import { usersRouter } from './routers/users';
// Phase 2 PR 28 routers — imported AFTER templates so their
// `registerDependentResolver('templates', ...)` call overwrites the PR 26
// shim. Module-load ordering is the registration order.
import { actionsRouter } from './routers/actions';
import { approvalsRouter } from './routers/approvals';
import { inspectionsRouter } from './routers/inspections';
import { signaturesRouter } from './routers/signatures';
import { router } from './trpc';

export const appRouter = router({
  health: healthRouter,
  permissions: permissionsRouter,
  users: usersRouter,
  customFields: customFieldsRouter,
  groups: groupsRouter,
  sites: sitesRouter,
  accessRules: accessRulesRouter,
  templates: templatesRouter,
  globalResponseSets: globalResponseSetsRouter,
  inspections: inspectionsRouter,
  signatures: signaturesRouter,
  approvals: approvalsRouter,
  actions: actionsRouter,
});

export type AppRouter = typeof appRouter;
