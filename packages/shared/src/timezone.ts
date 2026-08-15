/**
 * Timezone helpers for the scheduling engine (To-Do #1).
 *
 * The `rrule` package, when parsed without a TZID, produces "floating"
 * Date objects whose **UTC** fields hold the intended wall-clock time
 * (e.g. a 09:00 recurrence yields a Date whose `getUTCHours() === 9`).
 * Left as-is, the app then renders that 09:00 in the viewer's local zone,
 * so a London (BST, +1) user sees 10:00 — the bug reported in To-Do #1.
 *
 * These helpers reinterpret that floating wall-clock as a time IN the
 * schedule's configured timezone and convert it to a true UTC instant,
 * and format a true UTC instant back in a given timezone. No external
 * dependency — built on `Intl.DateTimeFormat`, which ships tz data.
 */

/**
 * Offset, in milliseconds, of `timeZone` from UTC at the given instant.
 * Positive east of UTC (e.g. +3_600_000 for Europe/London in summer).
 */
export function tzOffsetMs(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== 'literal') map[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    map.year ?? 1970,
    (map.month ?? 1) - 1,
    map.day ?? 1,
    map.hour ?? 0,
    map.minute ?? 0,
    map.second ?? 0,
  );
  return asUtc - at.getTime();
}

/**
 * Reinterpret a "floating" wall-clock Date (UTC fields hold the intended
 * local time, as produced by `rrule` without a TZID) as that local time
 * IN `timeZone`, returning the true UTC instant.
 *
 * Refines the offset once so DST boundaries near the target resolve to the
 * offset that actually applies at the resulting instant.
 */
export function floatingToZonedUtc(floating: Date, timeZone: string): Date {
  const approxOffset = tzOffsetMs(floating, timeZone);
  const candidate = new Date(floating.getTime() - approxOffset);
  const refinedOffset = tzOffsetMs(candidate, timeZone);
  return new Date(floating.getTime() - refinedOffset);
}

/** Format a true UTC instant as a localized date+time string in `timeZone`. */
export function formatInTimeZone(
  at: Date,
  timeZone: string,
  locale: string,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...opts,
  }).format(at);
}

/** The YYYY-MM-DD calendar day of a true UTC instant, in `timeZone`. */
export function zonedDayKey(at: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA formats as YYYY-MM-DD.
  return dtf.format(at);
}

// ─── Which clock a document is stamped in (BUG-14, per-site) ────────────────

/**
 * Is this a timezone the platform can safely stamp a legal document with?
 *
 * Two failure modes, and "does Intl accept it" only catches the first:
 *
 *   1. An unknown zone makes `Intl.DateTimeFormat` THROW, so an unvalidated
 *      value saved on a site would take out that site's permit PDF — the
 *      document somebody is standing at a gate waiting for.
 *   2. Worse, ICU accepts bare abbreviations and resolves them to something
 *      nobody means. `BST` is **Bangladesh** Standard Time, not British
 *      Summer Time: a permit stamped with it prints six hours out, which is
 *      BUG-14 again with a bigger offset. `EST` and `GMT` are the same trap.
 *
 * So a zone must be an unambiguous IANA identifier: a canonical name, or an
 * `Area/Location` alias ICU can format (`Asia/Kolkata` is a real name that
 * is absent from the canonical list), or literally `UTC`. Bare
 * abbreviations are refused — the UI offers a picker, so nobody has to type
 * one.
 */
const CANONICAL_ZONES: ReadonlySet<string> = new Set(
  ((): string[] => {
    try {
      return (
        (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
          'timeZone',
        ) ?? []
      );
    } catch {
      return [];
    }
  })(),
);

export function isValidTimeZone(timeZone: string): boolean {
  const zone = timeZone.trim();
  if (zone === '') return false;
  if (zone === 'UTC') return true;
  // An unambiguous name is either canonical or region-qualified. This is the
  // check that keeps `BST` out.
  if (!CANONICAL_ZONES.has(zone) && !zone.includes('/')) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * The clock a printed document should be stamped in.
 *
 * BUG-14 was that permit and incident PDFs printed UTC while the UI showed
 * local time, so an operative comparing the paper permit against the site
 * clock saw an hour's discrepancy — worse across BST. The first fix stamped
 * everything in one deployment-wide `APP_TIMEZONE`, which is correct for a
 * single-country operator and wrong the moment a customer runs sites in more
 * than one zone: their Frankfurt permit would print London time, which is
 * the same defect with a different offset.
 *
 * So the clock follows the WORK, not the server and not the head office:
 *
 *   1. the site the record belongs to, if it declares one;
 *   2. otherwise the tenant's default;
 *   3. otherwise the deployment's `APP_TIMEZONE`.
 *
 * Each level is validated, because a stale or hand-edited value must degrade
 * to the next level rather than throw at render time. The fallback is
 * assumed valid — it comes from the env schema — but is guarded too, since
 * "the PDF route is down" is a worse outcome than "the PDF says UTC".
 */
export function resolveDocumentTimeZone(
  siteTimeZone: string | null | undefined,
  tenantTimeZone: string | null | undefined,
  fallback: string,
): string {
  for (const candidate of [siteTimeZone, tenantTimeZone, fallback]) {
    if (typeof candidate === 'string' && isValidTimeZone(candidate)) return candidate;
  }
  return 'UTC';
}
