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
