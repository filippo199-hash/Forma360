import * as Sentry from '@sentry/nextjs';
import {
  buildSentryOptions,
  resolveEnvironment,
  resolveRelease,
} from '@forma360/shared/sentry-options';

/**
 * Sentry for the edge runtime (proxy/middleware, edge routes). Node APIs
 * are unavailable here; the SDK's edge build covers fetch-based capture.
 */
Sentry.init(
  buildSentryOptions({
    dsn: process.env.SENTRY_DSN,
    runtime: 'edge',
    environment: resolveEnvironment(process.env),
    release: resolveRelease(process.env),
    brand: process.env.BRAND,
    tracesSampleRate: 0.1,
  }),
);
