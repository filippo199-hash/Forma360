/**
 * i18n configuration — locale list and defaults.
 *
 * Forma360 ships in 10 locales at launch. Phase 0 only has real English
 * translations; the other 9 JSON files mirror en.json so the app renders
 * end-to-end during development. PR 10 swaps in professional translations.
 *
 * Locale codes use ISO 639-1 two-letter tags (no region variants) because
 * product scope doesn't yet demand per-region copy.
 */

export const LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'ja', 'zh'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Type guard for untrusted locale input (URL segments, cookies, Accept-Language).
 */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
