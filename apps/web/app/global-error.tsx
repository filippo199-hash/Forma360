'use client';

/**
 * The last-resort error screen (STAB-04).
 *
 * The app shipped with **no error boundary anywhere**. Two consequences,
 * and the quiet one is the worse one:
 *
 * 1. A client render error dropped the user on Next's default screen —
 *    unbranded, unrecoverable, and with nothing to quote to support.
 *    SWPD-04 (the conduct page's React #185 loop) is the known instance;
 *    it took a walkthrough to find.
 * 2. React rendering errors in the App Router were **never reported to
 *    Sentry**. The SDK says so at build time. So the failure mode was:
 *    the screen a user sees is broken, and the dashboard says all is well.
 *
 * `global-error` replaces the ROOT layout, so two things follow that look
 * like mistakes and are not:
 *
 * - It renders its own `<html>` and `<body>`. Nothing else will.
 * - The styling is inline. There is no root `layout.tsx` in this app —
 *   `globals.css` is imported by `[locale]/layout.tsx`, which is exactly
 *   the thing that has been replaced by the time this renders. A
 *   last-resort screen that depends on a stylesheet it cannot guarantee
 *   is not a last-resort screen.
 * - The copy is English. There is no intl context here either, for the
 *   same reason — this is the NR3-01 lesson (a provider calling
 *   `useTranslations` where no provider is mounted 500s the page), applied
 *   before it can happen rather than after.
 *
 * The error's own message is deliberately NOT rendered. That is the
 * BUG-17 / SWPD-01 rule: a raw error string is for the log, not the
 * screen. `digest` is shown instead — it is the hash Next assigns to the
 * error, so a screenshot can be matched to a log line without leaking
 * anything.
 */
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          background: '#f8fafc',
          color: '#0f172a',
        }}
      >
        <main style={{ maxWidth: '32rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '0 0 0.75rem' }}>
            Something went wrong
          </h1>
          <p style={{ margin: '0 0 1.5rem', lineHeight: 1.6, color: '#475569' }}>
            This page could not be displayed. The problem has been reported. Nothing you had already
            saved is affected.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              appearance: 'none',
              border: 0,
              borderRadius: '0.5rem',
              padding: '0.625rem 1.25rem',
              fontSize: '0.9375rem',
              fontWeight: 500,
              color: '#ffffff',
              background: '#0f172a',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest === undefined ? null : (
            <p style={{ marginTop: '1.5rem', fontSize: '0.75rem', color: '#94a3b8' }}>
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
