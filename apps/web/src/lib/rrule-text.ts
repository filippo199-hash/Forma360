/**
 * Turn an iCalendar RRULE string into a short human-readable phrase, e.g.
 *
 *   FREQ=WEEKLY;BYDAY=TU;BYHOUR=9;BYMINUTE=0  →  "Weekly on Tuesday at 09:00"
 *   FREQ=DAILY;BYHOUR=8                        →  "Daily at 08:00"
 *   FREQ=MONTHLY;BYMONTHDAY=1                   →  "Monthly on day 1"
 *
 * Kept deliberately lightweight (a tiny hand-rolled parser) so we don't pull
 * the full `rrule` package into the client bundle just to render a label. The
 * raw RRULE is returned verbatim if we can't recognise the shape, so nothing
 * is ever lost.
 */

const DAY_NAMES: Record<string, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
};

/** Ordinal suffix for a 1..31 month-day (1 → "1st", 2 → "2nd"…). */
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function frequencyPhrase(freq: string, interval: number): string | null {
  const single: Record<string, string> = {
    DAILY: 'Daily',
    WEEKLY: 'Weekly',
    MONTHLY: 'Monthly',
    YEARLY: 'Yearly',
  };
  const plural: Record<string, string> = {
    DAILY: 'days',
    WEEKLY: 'weeks',
    MONTHLY: 'months',
    YEARLY: 'years',
  };
  if (interval <= 1) return single[freq] ?? null;
  const unit = plural[freq];
  return unit === undefined ? null : `Every ${interval} ${unit}`;
}

/**
 * @param rrule    The stored RRULE string (may or may not carry the `RRULE:` prefix).
 * @param timezone Optional IANA timezone appended as "· Europe/London".
 */
export function humanizeRrule(rrule: string, timezone?: string): string {
  const cleaned = rrule.replace(/^RRULE:/i, '').trim();
  const params = new Map<string, string>();
  for (const part of cleaned.split(';')) {
    const [key, value] = part.split('=');
    if (key !== undefined && value !== undefined) params.set(key.toUpperCase(), value);
  }

  const freq = params.get('FREQ');
  const interval = Number.parseInt(params.get('INTERVAL') ?? '1', 10);
  const base = freq === undefined ? null : frequencyPhrase(freq, Number.isFinite(interval) ? interval : 1);
  if (base === null) {
    // Unrecognised shape — fall back to the raw rule so nothing is hidden.
    return timezone !== undefined && timezone.length > 0 ? `${cleaned} · ${timezone}` : cleaned;
  }

  const segments: string[] = [base];

  const byday = params.get('BYDAY');
  if (byday !== undefined && byday.length > 0) {
    const names = byday
      .split(',')
      .map((code) => DAY_NAMES[code.trim().toUpperCase().slice(-2)] ?? code.trim())
      .filter((n) => n.length > 0);
    if (names.length > 0) segments.push(`on ${names.join(', ')}`);
  } else {
    const bymonthday = params.get('BYMONTHDAY');
    if (bymonthday !== undefined && bymonthday.length > 0) {
      const day = Number.parseInt(bymonthday, 10);
      if (Number.isFinite(day)) segments.push(`on the ${ordinal(day)}`);
    }
  }

  const byhour = params.get('BYHOUR');
  if (byhour !== undefined && byhour.length > 0) {
    const hour = Number.parseInt(byhour.split(',')[0] ?? '', 10);
    const minute = Number.parseInt((params.get('BYMINUTE')?.split(',')[0] ?? '0'), 10);
    if (Number.isFinite(hour)) {
      const hh = String(hour).padStart(2, '0');
      const mm = String(Number.isFinite(minute) ? minute : 0).padStart(2, '0');
      segments.push(`at ${hh}:${mm}`);
    }
  }

  const phrase = segments.join(' ');
  return timezone !== undefined && timezone.length > 0 ? `${phrase} · ${timezone}` : phrase;
}
