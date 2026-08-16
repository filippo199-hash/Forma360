/**
 * The one place a date becomes a string.
 *
 * Four conventions were coexisting, on the same records:
 *
 *   - `8/9/2026` on the actions board and `8/6/2026` in the incident
 *     list — `toLocaleDateString(locale)` where `locale` is the bare
 *     next-intl segment. `LOCALES` are language codes with no region, so
 *     ICU resolves `'en'` to `en-US` and prints month-first. This is a
 *     UK product built around RIDDOR deadlines, and "8/6" reads as
 *     8 June to the person whose 10-day and 15-day clocks depend on it.
 *   - `09/08/2026` on the action detail and the inspection report —
 *     `toLocaleDateString()` with no argument, so the browser's locale
 *     wins and the same record renders differently two clicks apart.
 *   - `Aug 6, 2026` on the incident detail — same locale as the list,
 *     different options.
 *   - `2026-08-08` on the inspection form — the stored ISO string,
 *     unformatted.
 *
 * So: map the app locale to a region-qualified display locale, and pin
 * one house style. `dd MMM yyyy` is unambiguous in every reading order
 * — "16 Aug 2026" cannot be misread the way "8/16/2026" can.
 */
import { DEFAULT_LOCALE } from '@forma360/i18n/config';

/**
 * App locale → BCP-47 display locale.
 *
 * English maps to en-GB deliberately: the product's subject matter is
 * British health-and-safety law, and `en` alone means `en-US` to ICU.
 */
const DISPLAY_LOCALES: Record<string, string> = {
  en: 'en-GB',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  pt: 'pt-PT',
  it: 'it-IT',
  nl: 'nl-NL',
  pl: 'pl-PL',
  ja: 'ja-JP',
  zh: 'zh-CN',
};

export function displayLocale(locale: string | undefined): string {
  return DISPLAY_LOCALES[locale ?? DEFAULT_LOCALE] ?? DISPLAY_LOCALES[DEFAULT_LOCALE] ?? 'en-GB';
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `16 Aug 2026`. The house style for every date shown to a user. */
export function formatDate(
  value: Date | string | number | null | undefined,
  locale?: string,
  fallback = '—',
): string {
  const d = toDate(value);
  if (d === null) return fallback;
  return new Intl.DateTimeFormat(displayLocale(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

/**
 * `17:00`. Time-only, for stamps whose date is obvious from context (a
 * "last refreshed" tick, a sync log). Minutes, never seconds, 24-hour —
 * same clock the full formatDateTime uses.
 */
export function formatTime(
  value: Date | string | number | null | undefined,
  locale?: string,
  fallback = '—',
): string {
  const d = toDate(value);
  if (d === null) return fallback;
  return new Intl.DateTimeFormat(displayLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * `16 Aug 2026, 17:00`. Minutes, never seconds — a corrective action due
 * at "12:28:52 PM" is spurious precision nobody asked for.
 */
export function formatDateTime(
  value: Date | string | number | null | undefined,
  locale?: string,
  fallback = '—',
): string {
  const d = toDate(value);
  if (d === null) return fallback;
  return new Intl.DateTimeFormat(displayLocale(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}
