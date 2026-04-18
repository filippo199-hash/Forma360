/**
 * Sentry initialisation for the worker process.
 *
 * Called from main.ts before any handler imports so captured errors land in
 * the right project. If `SENTRY_DSN` is unset Sentry no-ops silently — fine
 * for local dev.
 */
import * as Sentry from '@sentry/node';

export function initSentry(): void {
  if (process.env.SENTRY_DSN === undefined || process.env.SENTRY_DSN.length === 0) {
    return;
  }
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    // Identify the worker process in Sentry so errors here don't mingle
    // with web-server errors in a shared project.
    serverName: 'forma360-worker',
  });
}
