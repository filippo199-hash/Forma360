/**
 * Locale-aware "3 hours ago" formatting via the built-in
 * `Intl.RelativeTimeFormat`, replacing the hand-rolled English
 * `"3h ago"` formatters scattered across the app (observations list,
 * QR codes, …). Picks the largest sensible unit.
 *
 * Client-only (uses `Date.now()`); pass the viewer's `locale`.
 */
export function relativeTime(input: Date | string | number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const then = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((then - Date.now()) / 1000); // past → negative
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_557_600],
    ['month', 2_629_800],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ];
  for (const [unit, secs] of units) {
    if (Math.abs(seconds) >= secs || unit === 'second') {
      return rtf.format(Math.round(seconds / secs), unit);
    }
  }
  return rtf.format(0, 'second');
}
