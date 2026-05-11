/**
 * Root tRPC router.
 *
 * Each module gets its own router under `src/routers/` and is merged in
 * here as a namespace. Phase 0: `health`. Phase 1: the org-backbone
 * surface. Phase 2 adds `templates` + `globalResponseSets` so far;
 * `inspections`, `signatures`, `approvals`, `schedules`, `actions` land
 * in PR 28+.
 */
import type { DeliveryResult } from '@forma360/shared/email';
import { createLogger } from '@forma360/shared/logger';
import { accessRulesRouter } from './routers/accessRules';
import { adminRouter } from './routers/admin';
import { createAuthRouter, type AuthRouterDeps } from './routers/auth';
import { customFieldsRouter } from './routers/customFields';
import { globalResponseSetsRouter } from './routers/globalResponseSets';
import { groupsRouter } from './routers/groups';
import { healthRouter } from './routers/health';
import { permissionsRouter } from './routers/permissions';
import { sitesRouter } from './routers/sites';
import { templatesRouter } from './routers/templates';
import { tenantsRouter } from './routers/tenants';
import { usersRouter } from './routers/users';
// Phase 2 PR 28 routers — imported AFTER templates so their
// `registerDependentResolver('templates', ...)` call overwrites the PR 26
// shim. Module-load ordering is the registration order.
import { actionsRouter } from './routers/actions';
import { approvalsRouter } from './routers/approvals';
import { createExportsRouter, type ExportsRouterDeps } from './routers/exports';
import { inspectionsRouter } from './routers/inspections';
import {
  createInspectionsExportRouter,
  type InspectionsExportDeps,
} from './routers/inspectionsExport';
import { schedulesRouter } from './routers/schedules';
import { signaturesRouter } from './routers/signatures';
import { router } from './trpc';

/**
 * Build the root tRPC router.
 *
 * The exports surface needs injected renderer + share-URL helpers
 * (they depend on env-level config — APP_URL, RENDER_SHARED_SECRET —
 * that the tRPC layer doesn't own). The web app wires these at boot;
 * tests pass deterministic mocks.
 */
export function buildAppRouter(deps: {
  exports: ExportsRouterDeps;
  inspectionsExport: InspectionsExportDeps;
  auth: AuthRouterDeps;
}) {
  return router({
    health: healthRouter,
    auth: createAuthRouter(deps.auth),
    admin: adminRouter,
    permissions: permissionsRouter,
    tenants: tenantsRouter,
    users: usersRouter,
    customFields: customFieldsRouter,
    groups: groupsRouter,
    sites: sitesRouter,
    accessRules: accessRulesRouter,
    templates: templatesRouter,
    globalResponseSets: globalResponseSetsRouter,
    inspections: inspectionsRouter,
    inspectionsExport: createInspectionsExportRouter(deps.inspectionsExport),
    signatures: signaturesRouter,
    approvals: approvalsRouter,
    actions: actionsRouter,
    schedules: schedulesRouter,
    exports: createExportsRouter(deps.exports),
  });
}

/**
 * Default app-router built with stub export deps. Kept so existing
 * tests + the admin test suite continue to import `appRouter` without
 * wiring the exports plumbing. Production wiring replaces these via
 * {@link buildAppRouter}.
 */
const stubExportsDeps: ExportsRouterDeps = {
  renderPdf: async () => {
    throw new Error('renderPdf not wired — build app router with buildAppRouter()');
  },
  renderDocx: async () => {
    throw new Error('renderDocx not wired — build app router with buildAppRouter()');
  },
  generateShareToken: () => {
    throw new Error('generateShareToken not wired — build app router with buildAppRouter()');
  },
  buildShareUrl: () => {
    throw new Error('buildShareUrl not wired — build app router with buildAppRouter()');
  },
};

/**
 * Default inspections-export deps — test-friendly. The `uploadCsv` stub
 * captures the body in a module-level map so tests that exercise the
 * `appRouter` default wiring can still read it back if needed.
 */
const stubInspectionsExportDeps: InspectionsExportDeps = {
  uploadCsv: async ({ key }) => ({ url: `stub://inspections-export/${key}` }),
  now: () => new Date(),
};

/**
 * Default auth-router deps — captures sent emails in a module-local
 * buffer (`__authStubMailbox`) so tests that exercise the default
 * `appRouter` can introspect what would have been sent. Production
 * wiring replaces these via {@link buildAppRouter}.
 */
export interface AuthStubMail {
  to: string;
  templateKey: string;
  variables: Record<string, string>;
}
export const __authStubMailbox: AuthStubMail[] = [];

/**
 * Test-only auth deps. Re-exported so tests can pass this when calling
 * `buildAppRouter` themselves and don't care about the auth surface.
 */
export const stubAuthDeps: AuthRouterDeps = {
  sendEmail: async (mail): Promise<DeliveryResult> => {
    __authStubMailbox.push({
      to: mail.to,
      templateKey: mail.templateKey,
      variables: mail.variables,
    });
    return { delivery: 'console' };
  },
  logger: createLogger({ service: 'auth-stub', level: 'fatal', nodeEnv: 'test' }),
  appUrl: 'http://localhost:3000',
};

export const appRouter = buildAppRouter({
  exports: stubExportsDeps,
  inspectionsExport: stubInspectionsExportDeps,
  auth: stubAuthDeps,
});

export type AppRouter = typeof appRouter;
