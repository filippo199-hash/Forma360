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
import { actionTypesRouter } from './routers/actionTypes';
import { approvalsRouter } from './routers/approvals';
import { assetTypesRouter } from './routers/assetTypes';
import { assetsRouter } from './routers/assets';
import { documentFoldersRouter } from './routers/documentFolders';
import { documentLabelsRouter } from './routers/documentLabels';
import { documentsRouter } from './routers/documents';
import { createExportsRouter, type ExportsRouterDeps } from './routers/exports';
import { createHeadsUpsRouter, type HeadsUpsRouterDeps } from './routers/headsUps';
import { createInspectionsRouter, type InspectionsRouterDeps } from './routers/inspections';
import {
  createInspectionsExportRouter,
  type InspectionsExportDeps,
} from './routers/inspectionsExport';
import { createIssuesRouter, type IssuesRouterDeps } from './routers/issues';
import { maintenancePlansRouter } from './routers/maintenancePlans';
import { maintenanceProgramsRouter } from './routers/maintenancePrograms';
import { aiAssistantRouter } from './routers/aiAssistant';
import { searchRouter } from './routers/search';
import { siteMediaRouter } from './routers/siteMedia';
import { sitePlansRouter } from './routers/sitePlans';
import { contractorsRouter } from './routers/contractors';
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
  inspections: InspectionsRouterDeps;
  issues: IssuesRouterDeps;
  headsUps: HeadsUpsRouterDeps;
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
    siteMedia: siteMediaRouter,
    sitePlans: sitePlansRouter,
    contractors: contractorsRouter,
    accessRules: accessRulesRouter,
    templates: templatesRouter,
    globalResponseSets: globalResponseSetsRouter,
    inspections: createInspectionsRouter(deps.inspections),
    inspectionsExport: createInspectionsExportRouter(deps.inspectionsExport),
    signatures: signaturesRouter,
    approvals: approvalsRouter,
    actions: actionsRouter,
    actionTypes: actionTypesRouter,
    schedules: schedulesRouter,
    exports: createExportsRouter(deps.exports),
    issues: createIssuesRouter(deps.issues),
    headsUps: createHeadsUpsRouter(deps.headsUps),
    assetTypes: assetTypesRouter,
    assets: assetsRouter,
    maintenancePlans: maintenancePlansRouter,
    maintenancePrograms: maintenanceProgramsRouter,
    documentFolders: documentFoldersRouter,
    documentLabels: documentLabelsRouter,
    documents: documentsRouter,
    search: searchRouter,
    aiAssistant: aiAssistantRouter,
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
 *
 * The signature-workflow tests share THIS mailbox (the
 * `stubInspectionsDeps` `sendEmail` also pushes into `__authStubMailbox`)
 * so a single import handles both surfaces. Tests reset it in `beforeEach`.
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

/**
 * Default inspections-router deps. Shares the `__authStubMailbox` so
 * tests have one place to read every captured email regardless of which
 * router sent it.
 */
export const stubInspectionsDeps: InspectionsRouterDeps = {
  sendEmail: async (mail): Promise<DeliveryResult> => {
    __authStubMailbox.push({
      to: mail.to,
      templateKey: mail.templateKey,
      variables: mail.variables,
    });
    return { delivery: 'console' };
  },
  logger: createLogger({ service: 'inspections-stub', level: 'fatal', nodeEnv: 'test' }),
  appUrl: 'http://localhost:3000',
};

/**
 * Default issues-router deps. Shares the `__authStubMailbox` so tests
 * exercising the issue-created notification path have one place to read
 * what would have been sent.
 */
export const stubIssuesDeps: IssuesRouterDeps = {
  sendEmail: async (mail): Promise<DeliveryResult> => {
    __authStubMailbox.push({
      to: mail.to,
      templateKey: mail.templateKey,
      variables: mail.variables,
    });
    return { delivery: 'console' };
  },
  logger: createLogger({ service: 'issues-stub', level: 'fatal', nodeEnv: 'test' }),
  appUrl: 'http://localhost:3000',
  storage: {
    getSignedDownloadUrl: async ({ key }) => `stub://issue-attachment/${key}`,
  },
};

/**
 * Default headsUps-router deps. Shares the `__authStubMailbox` so tests
 * that trigger reminder emails have one place to read what would have been sent.
 */
export const stubHeadsUpsDeps: HeadsUpsRouterDeps = {
  sendEmail: async (mail): Promise<DeliveryResult> => {
    __authStubMailbox.push({
      to: mail.to,
      templateKey: mail.templateKey,
      variables: mail.variables,
    });
    return { delivery: 'console' };
  },
};

export const appRouter = buildAppRouter({
  exports: stubExportsDeps,
  inspectionsExport: stubInspectionsExportDeps,
  auth: stubAuthDeps,
  inspections: stubInspectionsDeps,
  issues: stubIssuesDeps,
  headsUps: stubHeadsUpsDeps,
});

export type AppRouter = typeof appRouter;
