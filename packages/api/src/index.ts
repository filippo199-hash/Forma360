/**
 * @forma360/api — public entry point.
 *
 * The client consumes only the type of `appRouter` (via
 * `import type { AppRouter } from '@forma360/api'`). Runtime code lives
 * server-side in apps/web and tests.
 */
export { appRouter, buildAppRouter, type AppRouter } from './router';
export { createContextFactory, createTestContext, type Context } from './context';
export { createCallerFactory } from './trpc';
export type { ExportsRouterDeps } from './routers/exports';
export type { InspectionsExportDeps } from './routers/inspectionsExport';
export type { AuthRouterDeps } from './routers/auth';
export type { InspectionsRouterDeps } from './routers/inspections';
export type { IssuesRouterDeps } from './routers/issues';
export { setUsersRouterDeps, type UsersRouterDeps } from './routers/users';
export { setActionsRouterDeps } from './routers/actions';
export { setContractorsRouterDeps, type ContractorsRouterDeps } from './routers/contractors';
export type { HeadsUpsRouterDeps } from './routers/headsUps';
export type { RiskAssessmentsRouterDeps } from './routers/riskAssessments';
export type { CoshhRouterDeps } from './routers/coshh';
export type { PermitsRouterDeps } from './routers/permits';
export type { FireSafetyRouterDeps } from './routers/fireSafety';
