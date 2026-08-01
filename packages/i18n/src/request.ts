/**
 * next-intl request config.
 *
 * Invoked by next-intl's server-side helper on every request. Validates the
 * locale segment, loads the matching messages bundle (branded per ADR 0010),
 * and falls back to the default locale for anything unrecognised.
 *
 * Consumers (apps/web) import this via next-intl's plugin and don't need to
 * touch it themselves.
 */
import { resolveBrandId } from '@forma360/shared/brand';
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { loadBrandedMessages } from './brand-messages';
import { DEFAULT_LOCALE, LOCALES } from './config';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(LOCALES, requested) ? requested : DEFAULT_LOCALE;
  // Boundary read: next-intl gives this factory no way to receive the parsed
  // env object, so the brand id is resolved here with the same guarded
  // fallback the env schema uses (parseServerEnv has already validated BRAND
  // by the time any request reaches this code path).
  const brand = resolveBrandId(process.env.BRAND);
  const messages = await loadBrandedMessages(brand, locale);
  return {
    locale,
    messages,
  };
});
