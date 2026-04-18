import * as Sentry from '@sentry/nextjs';

/**
 * Sentry initialisation for the browser bundle.
 *
 * DSN is public (NEXT_PUBLIC_SENTRY_DSN). When unset (local dev, CI) Sentry
 * silently no-ops — every capture* call just drops on the floor.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  // Disable replay by default; enable per-user once we have consent UX.
  replaysOnErrorSampleRate: 0,
  replaysSessionSampleRate: 0,
});
