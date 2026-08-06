/**
 * Sentry initialisation for the worker process.
 *
 * Called from main.ts before any handler imports so captured errors land in
 * the right project. If `SENTRY_DSN` is unset Sentry no-ops silently — fine
 * for local dev and CI.
 *
 * Options come from the shared builder, so the worker applies exactly the
 * same PII scrubbing as the web runtimes. The worker matters most here:
 * it is the process that reads incident rows to send alert emails.
 */
import * as Sentry from '@sentry/node';
import {
  buildSentryOptions,
  resolveEnvironment,
  resolveRelease,
} from '@forma360/shared/sentry-options';

export function initSentry(): void {
  if (process.env.SENTRY_DSN === undefined || process.env.SENTRY_DSN.length === 0) {
    return;
  }
  Sentry.init({
    ...buildSentryOptions({
      dsn: process.env.SENTRY_DSN,
      runtime: 'worker',
      environment: resolveEnvironment(process.env),
      release: resolveRelease(process.env),
      brand: process.env.BRAND,
      tracesSampleRate: 0.1,
    }),
    // Identify the worker in a shared project so its errors don't mingle
    // with web-server errors.
    serverName: 'forma360-worker',
  });
}
