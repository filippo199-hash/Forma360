/**
 * Training & competence matrix — domain logic (FreeHS B7).
 *
 * Edge cases:
 *   - TR-E01: status vocabulary — required-but-absent is a gap, unrequired is a blank
 *   - TR-E02: expiry is computed from validity months and clamps at month end
 *   - TR-E03: a record with no expiry is permanently in date
 *   - TR-E04: expiring_soon honours the requirement's own lead time
 *   - TR-E05: append-only — the governing record is the furthest-reaching, not the newest row
 *   - TR-E06: "as at" answers competence on a past date, ignoring later renewals
 *   - TR-E07: compliance excludes not_required and returns null on an empty denominator
 *   - TR-E08: gap ordering puts expired before expiring before never-held
 */
import { describe, expect, it } from 'vitest';
import {
  compareTrainingStatus,
  compliancePercent,
  computeExpiry,
  currentRecord,
  GAP_STATUSES,
  isBlockingStatus,
  statusAsOf,
  TRAINING_STATUS_GLYPH,
  TRAINING_STATUSES,
  trainingStatus,
} from './training';

const NOW = new Date('2026-08-06T12:00:00.000Z');
const day = (n: number): Date => new Date(NOW.getTime() + n * 86_400_000);

describe('training domain (FreeHS B7)', () => {
  it('TR-E01: required-but-absent is a gap; unrequired is a blank', () => {
    expect(trainingStatus({ required: true, record: null, now: NOW })).toBe('not_held');
    expect(trainingStatus({ required: false, record: null, now: NOW })).toBe('not_required');

    // A held record keeps showing its real state even once unrequired —
    // the wallet must not blank a card because a role changed.
    const held = { achievedAt: day(-30), expiresAt: day(400) };
    expect(trainingStatus({ required: false, record: held, now: NOW })).toBe('in_date');

    // Every status has a glyph: status is never colour-only (Bello).
    for (const s of TRAINING_STATUSES) {
      expect(TRAINING_STATUS_GLYPH[s]).toBeTruthy();
    }
  });

  it('TR-E02: expiry computes from validity months and clamps at month end', () => {
    const jan31 = new Date('2026-01-31T09:00:00.000Z');
    // 31 Jan + 1 month must clamp to 28 Feb, never roll into March.
    expect(computeExpiry(jan31, 1)?.toISOString().slice(0, 10)).toBe('2026-02-28');
    // Leap year clamps to the 29th.
    expect(computeExpiry(new Date('2028-01-31T09:00:00.000Z'), 1)?.toISOString().slice(0, 10)).toBe(
      '2028-02-29',
    );
    // The ordinary case is exact, and the time of day survives.
    const mar15 = new Date('2026-03-15T09:30:00.000Z');
    expect(computeExpiry(mar15, 36)?.toISOString()).toBe('2029-03-15T09:30:00.000Z');
    // No validity period = a qualification that never expires.
    expect(computeExpiry(mar15, null)).toBeNull();
    expect(computeExpiry(mar15, 0)).toBeNull();
  });

  it('TR-E03: a record with no expiry is permanently in date', () => {
    const forever = { achievedAt: new Date('2001-01-01T00:00:00.000Z'), expiresAt: null };
    expect(trainingStatus({ required: true, record: forever, now: NOW })).toBe('in_date');
  });

  it('TR-E04: expiring_soon honours the requirement lead time', () => {
    const in30 = { achievedAt: day(-100), expiresAt: day(30) };
    // Default lead (60d) catches it; a 14-day lead does not.
    expect(trainingStatus({ required: true, record: in30, now: NOW })).toBe('expiring_soon');
    expect(trainingStatus({ required: true, record: in30, leadDays: 14, now: NOW })).toBe(
      'in_date',
    );

    // Boundaries: expiry exactly now is expired, not expiring.
    expect(
      trainingStatus({ required: true, record: { achievedAt: day(-1), expiresAt: NOW }, now: NOW }),
    ).toBe('expired');
    expect(
      trainingStatus({
        required: true,
        record: { achievedAt: day(-1), expiresAt: day(-1) },
        now: NOW,
      }),
    ).toBe('expired');
    expect(isBlockingStatus('expired')).toBe(true);
    expect(isBlockingStatus('not_held')).toBe(true);
    expect(isBlockingStatus('expiring_soon')).toBe(false);
  });

  it('TR-E05: the governing record is the furthest-reaching, not the newest row', () => {
    // A backdated entry typed after a renewal must not override it.
    const renewal = { achievedAt: day(-10), expiresAt: day(700) };
    const backdated = { achievedAt: day(-400), expiresAt: day(-30) };
    expect(currentRecord([renewal, backdated], NOW)).toBe(renewal);
    expect(currentRecord([backdated, renewal], NOW)).toBe(renewal);

    // A never-expiring record outranks any dated one.
    const forever = { achievedAt: day(-900), expiresAt: null };
    expect(currentRecord([renewal, forever], NOW)).toBe(forever);

    // Equal expiries break on the later achievement date.
    const older = { achievedAt: day(-50), expiresAt: day(100) };
    const newer = { achievedAt: day(-5), expiresAt: day(100) };
    expect(currentRecord([older, newer], NOW)).toBe(newer);

    expect(currentRecord([], NOW)).toBeNull();
  });

  it('TR-E06: "as at" answers competence on a past date', () => {
    // Lapsed on the day of the incident, renewed the week after. Today
    // reads in-date; the day itself must still read expired.
    const records = [
      { achievedAt: day(-400), expiresAt: day(-20) },
      { achievedAt: day(-5), expiresAt: day(700) },
    ];
    expect(statusAsOf({ required: true, records, asOf: NOW })).toBe('in_date');
    expect(statusAsOf({ required: true, records, asOf: day(-10) })).toBe('expired');
    // Before any record existed at all.
    expect(statusAsOf({ required: true, records, asOf: day(-500) })).toBe('not_held');
  });

  it('TR-E07: compliance excludes not_required and is null on an empty denominator', () => {
    // expiring_soon is still valid today, so it counts as compliant.
    expect(compliancePercent(['in_date', 'expiring_soon', 'expired', 'not_held'])).toBe(50);
    // not_required dilutes nothing in either direction.
    expect(compliancePercent(['in_date', 'not_required', 'not_required'])).toBe(100);
    expect(compliancePercent(['expired', 'not_required'])).toBe(0);
    // No applicable requirements reads "—", not 0% or 100%.
    expect(compliancePercent([])).toBeNull();
    expect(compliancePercent(['not_required', 'not_required'])).toBeNull();
  });

  it('TR-E08: gap ordering is expired, then expiring, then never-held', () => {
    const shuffled = ['in_date', 'not_held', 'expired', 'not_required', 'expiring_soon'] as const;
    expect([...shuffled].sort(compareTrainingStatus)).toEqual([
      'expired',
      'expiring_soon',
      'not_held',
      'in_date',
      'not_required',
    ]);
    // The gap list surfaces exactly the three that are gaps.
    expect(GAP_STATUSES).toEqual(['expired', 'expiring_soon', 'not_held']);
  });
});
