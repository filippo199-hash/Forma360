import * as Sentry from '@sentry/nextjs';
import {
  buildSentryOptions,
  resolveEnvironment,
  resolveRelease,
} from '@forma360/shared/sentry-options';

/**
 * Sentry for the Node server runtime (route handlers, RSC, server actions).
 *
 * Uses the server-only SENTRY_DSN so browser bundles never see the server
 * project's DSN. Options — including the PII scrubber — come from the
 * shared builder so all four runtimes cannot drift apart.
 */
Sentry.init(
  buildSentryOptions({
    dsn: process.env.SENTRY_DSN,
    runtime: 'server',
    environment: resolveEnvironment(process.env),
    release: resolveRelease(process.env),
    brand: process.env.BRAND,
    tracesSampleRate: 0.1,
  }),
);
