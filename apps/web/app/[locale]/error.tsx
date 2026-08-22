'use client';

/**
 * The in-app error boundary (STAB-04).
 *
 * `global-error` is the last resort and throws away the whole shell to get
 * there. This one sits inside the locale layout, so a failing page loses
 * the page and keeps the navigation, the theme and the session — which is
 * the difference between "this screen broke, go somewhere else" and "the
 * app broke".
 *
 * It runs inside `NextIntlClientProvider`, so it can translate. If the
 * layout itself is what threw, Next escalates past this boundary to
 * `global-error`, which is English-only for exactly that reason.
 *
 * `error.message` is deliberately not rendered — the BUG-17 / SWPD-01
 * rule. `digest` is, because it is the one thing a user can read out that
 * matches their screenshot to a log line.
 */
import * as Sentry from '@sentry/nextjs';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Button } from '../../src/components/ui/button';

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">{t('error')}</h1>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{t('errorBody')}</p>
        <Button type="button" onClick={reset} className="mt-6">
          {t('retry')}
        </Button>
        {error.digest === undefined ? null : (
          <p className="text-muted-foreground/70 mt-6 text-xs">
            {t('errorReference', { reference: error.digest })}
          </p>
        )}
      </div>
    </div>
  );
}
