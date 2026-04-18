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
