/**
 * ActivityTimeline grouping (review round 4).
 *
 * The trap this pins: day keys must come from LOCAL date parts. The
 * pre-existing gallery grouping used `toISOString().slice(0, 10)`, which
 * buckets a 23:40 entry into the next day for any viewer west of UTC —
 * exactly the audience of a day-grouped "what happened when" timeline.
 * Vitest here runs under TZ=UTC unless the environment overrides it, so
 * the local-vs-UTC assertions construct dates from local parts.
 */
import { describe, expect, it } from 'vitest';
import { localDayKey } from '../lib/format-date';
import { groupTimelineEntries } from './activity-timeline';

function at(y: number, m: number, d: number, hh = 12, mm = 0): Date {
  // Local-time constructor on purpose — the grouping is local.
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

describe('groupTimelineEntries', () => {
  it('buckets a newest-first stream into contiguous day groups', () => {
    const entries = [
      { id: 'e', at: at(2026, 8, 16, 17, 30) },
      { id: 'd', at: at(2026, 8, 16, 9, 5) },
      { id: 'c', at: at(2026, 8, 15, 23, 59) },
      { id: 'b', at: at(2026, 8, 15, 0, 0) },
      { id: 'a', at: at(2026, 8, 1, 8, 0) },
    ];
    const groups = groupTimelineEntries(entries);
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([['e', 'd'], ['c', 'b'], ['a']]);
    expect(groups.map((g) => g.key)).toEqual(['2026-08-16', '2026-08-15', '2026-08-01']);
  });

  it('keeps row order inside each group (newest first, as delivered)', () => {
    const entries = [
      { id: 'later', at: at(2026, 1, 2, 15, 0) },
      { id: 'earlier', at: at(2026, 1, 2, 9, 0) },
    ];
    const groups = groupTimelineEntries(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(['later', 'earlier']);
  });

  it('accepts ISO strings and unparseable stamps degrade to one "unknown" bucket', () => {
    const groups = groupTimelineEntries([
      { id: 'ok', at: '2026-03-04T10:00:00.000Z' },
      { id: 'bad', at: 'not-a-date' },
    ]);
    expect(groups.map((g) => g.key)).toContain('unknown');
    expect(groups.flatMap((g) => g.rows.map((r) => r.id))).toEqual(['ok', 'bad']);
  });

  it('empty input yields no groups', () => {
    expect(groupTimelineEntries([])).toEqual([]);
  });
});

describe('localDayKey', () => {
  it('uses local date parts, not the UTC day', () => {
    // 23:40 LOCAL on the 15th. In any UTC-negative zone the UTC day is
    // the 16th — the key must still say 15.
    const lateEvening = at(2026, 8, 15, 23, 40);
    expect(localDayKey(lateEvening)).toBe('2026-08-15');
  });

  it('zero-pads month and day', () => {
    expect(localDayKey(at(2026, 1, 2))).toBe('2026-01-02');
  });

  it('returns null for null/invalid input', () => {
    expect(localDayKey(null)).toBeNull();
    expect(localDayKey('garbage')).toBeNull();
  });
});
