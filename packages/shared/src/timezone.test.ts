import { describe, expect, it } from 'vitest';
import {
  floatingToZonedUtc,
  formatInTimeZone,
  isValidTimeZone,
  resolveDocumentTimeZone,
  tzOffsetMs,
  zonedDayKey,
} from './timezone';

describe('timezone helpers (To-Do #1)', () => {
  it('reinterprets a floating 09:00 as 09:00 Europe/London in summer (BST → 08:00Z)', () => {
    // rrule yields the wall-clock in UTC fields.
    const floating = new Date('2026-06-23T09:00:00.000Z');
    const utc = floatingToZonedUtc(floating, 'Europe/London');
    expect(utc.toISOString()).toBe('2026-06-23T08:00:00.000Z');
    // And formatting that instant back in London shows 09:00, not 10:00.
    expect(formatInTimeZone(utc, 'Europe/London', 'en-GB', { hour12: false })).toContain('09:00');
  });

  it('leaves a winter 09:00 Europe/London at 09:00Z (GMT, no offset)', () => {
    const floating = new Date('2026-01-15T09:00:00.000Z');
    const utc = floatingToZonedUtc(floating, 'Europe/London');
    expect(utc.toISOString()).toBe('2026-01-15T09:00:00.000Z');
  });

  it('handles a positive offset zone (New York, EDT → 13:00Z for 09:00 local)', () => {
    const floating = new Date('2026-06-23T09:00:00.000Z');
    const utc = floatingToZonedUtc(floating, 'America/New_York');
    expect(utc.toISOString()).toBe('2026-06-23T13:00:00.000Z');
  });

  it('tzOffsetMs is +1h for London in summer, 0 in winter', () => {
    expect(tzOffsetMs(new Date('2026-06-23T12:00:00Z'), 'Europe/London')).toBe(3_600_000);
    expect(tzOffsetMs(new Date('2026-01-15T12:00:00Z'), 'Europe/London')).toBe(0);
  });

  it('zonedDayKey reports the local calendar day', () => {
    // 23:30Z on the 22nd is still the 23rd 00:30 in Europe/London (summer).
    expect(zonedDayKey(new Date('2026-06-22T23:30:00Z'), 'Europe/London')).toBe('2026-06-23');
  });
});

describe('document timezone (BUG-14, per-site)', () => {
  it('TZ-D01 — the site wins over the tenant, and the tenant over the deployment', () => {
    expect(resolveDocumentTimeZone('America/New_York', 'Europe/Berlin', 'Europe/London')).toBe(
      'America/New_York',
    );
    expect(resolveDocumentTimeZone(null, 'Europe/Berlin', 'Europe/London')).toBe('Europe/Berlin');
    expect(resolveDocumentTimeZone(null, null, 'Europe/London')).toBe('Europe/London');
  });

  it('TZ-D02 — an unset level is skipped, not treated as a choice', () => {
    // Empty string is what an HTML input sends when it is cleared, so it has
    // to mean "inherit" and not "no timezone".
    expect(resolveDocumentTimeZone('', 'Europe/Berlin', 'Europe/London')).toBe('Europe/Berlin');
    expect(resolveDocumentTimeZone('   ', '', 'Europe/London')).toBe('Europe/London');
    expect(resolveDocumentTimeZone(undefined, undefined, 'Europe/London')).toBe('Europe/London');
  });

  it('TZ-D03 — a bad zone degrades to the next level instead of throwing', () => {
    // Intl THROWS on an unknown zone, so an unvalidated value saved on a site
    // would take out that site's permit PDF — the document somebody is
    // standing at a gate waiting for.
    expect(resolveDocumentTimeZone('Mars/Olympus_Mons', 'Europe/Berlin', 'Europe/London')).toBe(
      'Europe/Berlin',
    );
    expect(resolveDocumentTimeZone('Mars/Olympus_Mons', 'Also/Nonsense', 'Europe/London')).toBe(
      'Europe/London',
    );
    // Even a broken fallback must not throw — UTC is wrong but printable.
    expect(resolveDocumentTimeZone(null, null, 'Not/AZone')).toBe('UTC');
  });

  it('TZ-D04 — the resolved zone actually formats, at the offsets that matter', () => {
    // The BUG-14 case: a permit valid 08:00–16:00 local, printed from a UTC
    // server, during BST.
    const summer = new Date('2026-08-15T07:00:00Z');
    expect(
      formatInTimeZone(summer, resolveDocumentTimeZone(null, null, 'Europe/London'), 'en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    ).toContain('08:00');
    // Same instant, a site in Berlin: one hour further on, not London's time.
    expect(
      formatInTimeZone(
        summer,
        resolveDocumentTimeZone('Europe/Berlin', null, 'Europe/London'),
        'en-GB',
        {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        },
      ),
    ).toContain('09:00');
  });

  it('TZ-D05 — isValidTimeZone accepts real zones and rejects the rest', () => {
    for (const good of ['UTC', 'Europe/London', 'America/New_York', 'Asia/Tokyo']) {
      expect({ zone: good, valid: isValidTimeZone(good) }).toEqual({ zone: good, valid: true });
    }
    // The dangerous ones. ICU HAPPILY formats these — `BST` resolves to
    // Bangladesh Standard Time, six hours off the British Summer Time
    // whoever typed it meant, and a permit stamped with it prints six hours
    // out. That is BUG-14 again with a bigger offset, so bare abbreviations
    // are refused outright.
    for (const bad of ['', '   ', 'Mars/Olympus_Mons', 'Europe//London', 'BST', 'EST', 'GMT']) {
      expect({ zone: bad, valid: isValidTimeZone(bad) }).toEqual({ zone: bad, valid: false });
    }
    // …and the aliases that are NOT in the canonical list must still work.
    for (const good of ['Asia/Kolkata', 'Etc/UTC']) {
      expect({ zone: good, valid: isValidTimeZone(good) }).toEqual({ zone: good, valid: true });
    }
  });
});
