import { describe, expect, it } from 'vitest';
import { MAX_OCCURRENCES_PER_RULE, occurrencesBetween, validateRrule } from './schedule-rrule';

describe('schedule-rrule DoS guards', () => {
  it('validateRrule rejects sub-hourly frequencies', () => {
    expect(validateRrule('FREQ=SECONDLY')).toMatch(/too high/i);
    expect(validateRrule('FREQ=MINUTELY')).toMatch(/too high/i);
    expect(validateRrule('FREQ=MINUTELY;INTERVAL=30')).toMatch(/too high/i);
  });

  it('validateRrule accepts hourly and coarser cadences', () => {
    expect(validateRrule('FREQ=HOURLY')).toBeNull();
    expect(validateRrule('FREQ=DAILY;BYHOUR=9')).toBeNull();
    expect(validateRrule('FREQ=WEEKLY;BYDAY=MO')).toBeNull();
    expect(validateRrule('FREQ=MONTHLY')).toBeNull();
  });

  it('validateRrule still requires a parseable FREQ', () => {
    expect(validateRrule('not-an-rrule')).not.toBeNull();
  });

  it('occurrencesBetween caps expansion at MAX_OCCURRENCES_PER_RULE', () => {
    // An hourly rule over a full year is ~8760 occurrences — must be capped
    // so the worker can't build an unbounded array.
    const start = new Date('2020-01-01T00:00:00Z');
    const out = occurrencesBetween({
      rrule: 'FREQ=HOURLY',
      startAt: start,
      from: start,
      until: new Date('2020-12-31T00:00:00Z'),
    });
    expect(out.length).toBe(MAX_OCCURRENCES_PER_RULE);
  });

  it('occurrencesBetween returns the full set when under the cap', () => {
    const start = new Date('2020-01-01T00:00:00Z');
    const out = occurrencesBetween({
      rrule: 'FREQ=DAILY',
      startAt: start,
      from: start,
      until: new Date('2020-01-11T00:00:00Z'), // ~10 days
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(MAX_OCCURRENCES_PER_RULE);
  });
});
