/**
 * next-intl request config.
 *
 * Invoked by next-intl's server-side helper on every request. Validates the
 * locale segment, loads the matching messages bundle, and falls back to the
 * default locale for anything unrecognised.
 *
 * Consumers (apps/web) import this via next-intl's plugin and don't need to
 * touch it themselves.
 */
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALES } from './config';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(LOCALES, requested) ? requested : DEFAULT_LOCALE;
  const messages = (await import(`../messages/${locale}.json`)).default as Record<string, unknown>;
  return {
    locale,
    messages,
  };
});
