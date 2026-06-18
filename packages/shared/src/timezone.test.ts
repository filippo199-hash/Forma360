import { describe, expect, it } from 'vitest';
import { floatingToZonedUtc, formatInTimeZone, tzOffsetMs, zonedDayKey } from './timezone';

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
