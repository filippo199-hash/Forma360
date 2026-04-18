import * as Sentry from '@sentry/nextjs';

/**
 * Sentry initialisation for the edge runtime (middleware, edge API routes).
 * Node APIs are not available here; Sentry's edge-compatible init covers
 * fetch-based request capture only.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});
