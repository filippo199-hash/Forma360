/**
 * Next 16 instrumentation hook. Called once per runtime at boot. We lazy-load
 * the right Sentry config so each runtime only pays for what it uses.
 */
import type * as SentryNext from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * Catches errors raised by React Server Components and forwards them to
 * Sentry. Exported by Next from the same instrumentation module.
 */
export const onRequestError: typeof SentryNext.captureRequestError = async (...args) => {
  const { captureRequestError } = await import('@sentry/nextjs');
  return captureRequestError(...args);
};
