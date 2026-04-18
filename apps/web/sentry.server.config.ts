import * as Sentry from '@sentry/nextjs';

/**
 * Sentry initialisation for the Node server runtime (route handlers, RSC,
 * server actions). Uses the server-only SENTRY_DSN so browser bundles do
 * not leak the server project's DSN.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  // The Node integrations Sentry adds by default are fine for Phase 0.
  // We'll tune sampling + add http-breadcrumbs-filtering in later phases
  // once real volume arrives.
});
