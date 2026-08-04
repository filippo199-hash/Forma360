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
import { createAnalyticsRouter } from './routers/analytics';
import { createMyWorkRouter } from './routers/myWork';
import { notificationsRouter } from './routers/notifications';
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
import { createCoshhRouter, type CoshhRouterDeps } from './routers/coshh';
import { createPermitsRouter, type PermitsRouterDeps } from './routers/permits';
import { createFireSafetyRouter, type FireSafetyRouterDeps } from './routers/fireSafety';
import { createIncidentsRouter, type IncidentsRouterDeps } from './routers/incidents';
import { createRamsRouter, type RamsRouterDeps } from './routers/rams';
import {
  createRiskAssessmentsRouter,
  type RiskAssessmentsRouterDeps,
} from './routers/riskAssessments';
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
  /**
   * Brand-gated (ADR 0010). Optional so pre-existing callers compile;
   * omitting it DISABLES the module — production wiring passes the active
   * brand's catalogue verdict explicitly.
   */
  riskAssessments?: RiskAssessmentsRouterDeps;
  /**
   * Brand-gated (ADR 0010), same contract as riskAssessments: omitting it
   * DISABLES the module — production wiring passes the active brand's
   * catalogue verdict explicitly.
   */
  coshh?: CoshhRouterDeps;
  /**
   * Brand-gated (ADR 0010), same contract as riskAssessments / coshh:
   * omitting it DISABLES the module.
   */
  permits?: PermitsRouterDeps;
  fireSafety?: FireSafetyRouterDeps;
  incidents?: IncidentsRouterDeps;
  /**
   * Brand-gated (ADR 0010), same contract as the other B-modules:
   * omitting it DISABLES the module.
   */
  rams?: RamsRouterDeps;
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
    notifications: notificationsRouter,
    // ADR 0014: the caller's own queue. Ungated on purpose — it can only
    // ever return rows assigned to the caller. It also serves the menu's
    // needs-attention numbers, so it takes the same brand flags the
    // module routers do — a deployment never queries a module it does
    // not ship.
    myWork: createMyWorkRouter({
      enabledModules: [
        ...(deps.incidents?.enabled === true ? (['incidents'] as const) : []),
        ...(deps.permits?.enabled === true ? (['permits'] as const) : []),
        ...(deps.riskAssessments?.enabled === true ? (['riskAssessments'] as const) : []),
        ...(deps.fireSafety?.enabled === true ? (['fireSafety'] as const) : []),
      ],
    }),
    // PF-5: dashboard tiles for brand-gated modules follow the same enabled
    // flags as the routers themselves — one source of truth (ADR 0010).
    analytics: createAnalyticsRouter({
      modules: {
        riskAssessments: deps.riskAssessments?.enabled ?? false,
        coshh: deps.coshh?.enabled ?? false,
        permits: deps.permits?.enabled ?? false,
        rams: deps.rams?.enabled ?? false,
      },
    }),
    riskAssessments: createRiskAssessmentsRouter(deps.riskAssessments ?? { enabled: false }),
    coshh: createCoshhRouter(deps.coshh ?? { enabled: false }),
    permits: createPermitsRouter(deps.permits ?? { enabled: false }),
    fireSafety: createFireSafetyRouter(deps.fireSafety ?? { enabled: false }),
    incidents: createIncidentsRouter(deps.incidents ?? { enabled: false }),
    rams: createRamsRouter(deps.rams ?? { enabled: false }),
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

/** Test-only risk-assessments deps — the module is enabled so the full
 * surface is exercisable; brand gating is tested by building the router
 * with `enabled: false` explicitly. Shares the `__authStubMailbox` so
 * tests can read the distribution emails that would have been sent. */
export const stubRiskAssessmentsDeps: RiskAssessmentsRouterDeps = {
  enabled: true,
  sendEmail: async (mail): Promise<DeliveryResult> => {
    __authStubMailbox.push({
      to: mail.to,
      templateKey: mail.templateKey,
      variables: mail.variables,
    });
    return { delivery: 'console' };
  },
  appUrl: 'http://localhost:3000',
};

/** Test-only coshh deps — enabled, so the full surface is exercisable;
 * brand gating is tested by building the router with `enabled: false`. */
export const stubCoshhDeps: CoshhRouterDeps = { enabled: true };

/** Test-only permits deps — same contract as coshh. */
export const stubPermitsDeps: PermitsRouterDeps = { enabled: true };

/** Test-only fire-safety deps — enabled, so the full surface is
 * exercisable; brand gating is tested with `enabled: false`. */
export const stubFireSafetyDeps: FireSafetyRouterDeps = { enabled: true };

/** Test-only incidents deps — enabled; brand gating is tested with
 * `enabled: false`. */
export const stubIncidentsDeps: IncidentsRouterDeps = { enabled: true };

/**
 * Test-only RAMS deps — enabled; brand gating is tested with
 * `enabled: false`. Share-link helpers are deterministic so the
 * client-acceptance tests can assert on the token they get back.
 */
let __ramsShareTokenSeq = 0;
export const stubRamsDeps: RamsRouterDeps = {
  enabled: true,
  generateShareToken: () => `rams-stub-token-${(__ramsShareTokenSeq += 1)}`,
  buildShareUrl: (token) => `http://localhost:3000/s/${token}`,
  // Stubbed rather than absent so the RS-A14 guard (a version must belong
  // to the pack) is reachable in tests instead of short-circuiting on
  // `render-not-wired`.
  renderPdf: async ({ packId, packVersionId }) => ({
    key: `stub://rams-pdf/${packId}/${packVersionId}`,
    bytes: 0,
    stub: true,
  }),
  appUrl: 'http://localhost:3000',
};

export const appRouter = buildAppRouter({
  exports: stubExportsDeps,
  inspectionsExport: stubInspectionsExportDeps,
  auth: stubAuthDeps,
  inspections: stubInspectionsDeps,
  issues: stubIssuesDeps,
  headsUps: stubHeadsUpsDeps,
  riskAssessments: stubRiskAssessmentsDeps,
  coshh: stubCoshhDeps,
  permits: stubPermitsDeps,
  fireSafety: stubFireSafetyDeps,
  incidents: stubIncidentsDeps,
  rams: stubRamsDeps,
});

export type AppRouter = typeof appRouter;
