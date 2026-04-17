/**
 * next-intl routing configuration shared between middleware and the App
 * Router. Defining it in a package file keeps the locale list + default
 * locale in exactly one place.
 */
import { defineRouting } from 'next-intl/routing';
import { DEFAULT_LOCALE, LOCALES } from './config';

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  // Always prefix URLs with the locale ("/en/...") rather than hiding the
  // default. Explicit URLs are easier to share and easier to cache.
  localePrefix: 'always',
});
