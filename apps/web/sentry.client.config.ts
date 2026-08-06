import * as Sentry from '@sentry/nextjs';
import {
  buildSentryOptions,
  resolveEnvironment,
  resolveRelease,
} from '@forma360/shared/sentry-options';

/**
 * Sentry for the browser bundle.
 *
 * The DSN is public by design (NEXT_PUBLIC_SENTRY_DSN) and points at a
 * separate project from the server. Session Replay stays off: it records
 * the DOM, and these screens show incident narratives and injury details.
 * Turning it on would need a consent flow and a privacy-mask pass first.
 */
Sentry.init({
  ...buildSentryOptions({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    runtime: 'browser',
    environment: resolveEnvironment({
      SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
      NODE_ENV: process.env.NODE_ENV,
    }),
    release: resolveRelease({ SENTRY_RELEASE: process.env.NEXT_PUBLIC_SENTRY_RELEASE }),
    brand: process.env.NEXT_PUBLIC_BRAND,
    tracesSampleRate: 0.1,
  }),
  replaysOnErrorSampleRate: 0,
  replaysSessionSampleRate: 0,
});
