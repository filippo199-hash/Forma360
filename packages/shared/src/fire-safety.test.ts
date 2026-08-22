/**
 * Unit tests for the Fire Safety domain helpers.
 *
 * Edge cases covered (module-level IDs, see the fireSafety router tests
 * for FS-E10 onwards):
 *   - FS-E01: high-rise residential classification — 18 m / 7 storeys
 *     boundaries, non-residential never qualifies
 *   - FS-E02: above-11-metre regime is strictly above 11 m, and a
 *     high-rise-by-storeys building with unknown height still qualifies
 *   - FS-E03: requiredCheckTypesFor — base set always; system-gated
 *     checks only with their flag; high-rise duties only when high-rise
 *   - FS-E04: due-date arithmetic — weekly adds seven days, monthly
 *     clamps to month-end instead of drifting into the next month
 *   - FS-E05: checkDueStatus boundaries — due exactly now is overdue,
 *     due-soon window scales with the frequency
 *   - FS-E06: door inspection regime — quarterly common parts / annual
 *     flat entrance above 11 m residential, six-monthly default
 *     elsewhere, per-door override wins
 *   - FS-E07: suggested FRA review cadence tightens with the risk rating
 */
import { describe, expect, it } from 'vitest';
import {
  checkDisplayStatus,
  doorDisplayStatus,
  parseDoorImport,
  addMonthsClamped,
  checkDueStatus,
  doorInspectionIntervalMonths,
  FIRE_CHECK_TYPE_SPECS,
  FIRE_CHECK_TYPES,
  isAbove11mResidential,
  isHighRiseResidential,
  marshalTrainingStatus,
  nextDueDate,
  requiredCheckTypesFor,
  suggestedFraReviewMonths,
  type FireBuildingProfile,
  drillConcerns,
  drillNeedsFollowUp,
  drillActionPriority,
} from './fire-safety';

function profile(overrides: Partial<FireBuildingProfile> = {}): FireBuildingProfile {
  return {
    isResidential: false,
    heightMetres: null,
    storeys: null,
    hasFireAlarm: true,
    hasEmergencyLighting: true,
    hasSprinklers: false,
    hasDampers: false,
    hasRisers: false,
    ...overrides,
  };
}

describe('isHighRiseResidential (FS-E01)', () => {
  it('qualifies at 18 m or 7 storeys, not below', () => {
    expect(isHighRiseResidential(profile({ isResidential: true, heightMetres: 18 }))).toBe(true);
    expect(isHighRiseResidential(profile({ isResidential: true, heightMetres: 17.9 }))).toBe(false);
    expect(isHighRiseResidential(profile({ isResidential: true, storeys: 7 }))).toBe(true);
    expect(isHighRiseResidential(profile({ isResidential: true, storeys: 6 }))).toBe(false);
  });

  it('either criterion alone is enough', () => {
    expect(
      isHighRiseResidential(profile({ isResidential: true, heightMetres: 20, storeys: 5 })),
    ).toBe(true);
    expect(
      isHighRiseResidential(profile({ isResidential: true, heightMetres: 12, storeys: 8 })),
    ).toBe(true);
  });

  it('never qualifies a non-residential building', () => {
    expect(isHighRiseResidential(profile({ heightMetres: 40, storeys: 12 }))).toBe(false);
  });
});

describe('isAbove11mResidential (FS-E02)', () => {
  it('is strictly above 11 metres', () => {
    expect(isAbove11mResidential(profile({ isResidential: true, heightMetres: 11 }))).toBe(false);
    expect(isAbove11mResidential(profile({ isResidential: true, heightMetres: 11.1 }))).toBe(true);
  });

  it('a high-rise by storey count with unknown height still qualifies', () => {
    expect(isAbove11mResidential(profile({ isResidential: true, storeys: 7 }))).toBe(true);
    expect(isAbove11mResidential(profile({ isResidential: true, storeys: 6 }))).toBe(false);
  });

  it('non-residential is out regardless of height', () => {
    expect(isAbove11mResidential(profile({ heightMetres: 30 }))).toBe(false);
  });
});

describe('requiredCheckTypesFor (FS-E03)', () => {
  it('seeds the base set for a plain building', () => {
    const types = requiredCheckTypesFor(profile());
    expect(types).toContain('alarm_test');
    expect(types).toContain('detection_service');
    expect(types).toContain('emergency_lighting_function');
    expect(types).toContain('emergency_lighting_duration');
    expect(types).toContain('extinguisher_visual');
    expect(types).toContain('extinguisher_service');
    expect(types).toContain('fire_drill');
    expect(types).not.toContain('sprinkler_check');
    expect(types).not.toContain('damper_test');
    expect(types).not.toContain('riser_service');
    expect(types).not.toContain('secure_info_box_check');
  });

  it('system flags gate their checks', () => {
    const types = requiredCheckTypesFor(
      profile({ hasSprinklers: true, hasDampers: true, hasRisers: true }),
    );
    expect(types).toContain('sprinkler_check');
    expect(types).toContain('damper_test');
    expect(types).toContain('riser_service');
    const noAlarm = requiredCheckTypesFor(
      profile({ hasFireAlarm: false, hasEmergencyLighting: false }),
    );
    expect(noAlarm).not.toContain('alarm_test');
    expect(noAlarm).not.toContain('detection_service');
    expect(noAlarm).not.toContain('emergency_lighting_function');
  });

  it('high-rise residential adds the 2022 Regulations duties', () => {
    const highRise = requiredCheckTypesFor(
      profile({ isResidential: true, heightMetres: 19, storeys: 8 }),
    );
    expect(highRise).toContain('lift_firefighting_check');
    expect(highRise).toContain('secure_info_box_check');
    expect(highRise).toContain('wayfinding_signage_check');
    const lowRise = requiredCheckTypesFor(profile({ isResidential: true, heightMetres: 12 }));
    expect(lowRise).not.toContain('secure_info_box_check');
  });

  it('every catalogue type has a spec', () => {
    for (const type of FIRE_CHECK_TYPES) {
      expect(FIRE_CHECK_TYPE_SPECS[type]).toBeDefined();
    }
  });
});

describe('due-date arithmetic (FS-E04)', () => {
  it('weekly adds exactly seven days', () => {
    const due = nextDueDate(new Date(Date.UTC(2026, 0, 5)), 'weekly');
    expect(due.toISOString().slice(0, 10)).toBe('2026-01-12');
  });

  it('monthly clamps to month-end instead of drifting', () => {
    const due = nextDueDate(new Date(Date.UTC(2026, 0, 31)), 'monthly');
    expect(due.toISOString().slice(0, 10)).toBe('2026-02-28');
    const leap = nextDueDate(new Date(Date.UTC(2028, 0, 31)), 'monthly');
    expect(leap.toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('quarterly, six-monthly and annual add calendar months', () => {
    const base = new Date(Date.UTC(2026, 4, 15));
    expect(nextDueDate(base, 'quarterly').toISOString().slice(0, 10)).toBe('2026-08-15');
    expect(nextDueDate(base, 'six_monthly').toISOString().slice(0, 10)).toBe('2026-11-15');
    expect(nextDueDate(base, 'annual').toISOString().slice(0, 10)).toBe('2027-05-15');
  });

  it('addMonthsClamped keeps ordinary days as-is', () => {
    expect(
      addMonthsClamped(new Date(Date.UTC(2026, 2, 10)), 3)
        .toISOString()
        .slice(0, 10),
    ).toBe('2026-06-10');
  });
});

describe('checkDueStatus (FS-E05)', () => {
  const now = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

  it('due exactly now is overdue, not due-soon', () => {
    expect(checkDueStatus(now, 'weekly', now)).toBe('overdue');
    expect(checkDueStatus(new Date(now.getTime() - 1000), 'annual', now)).toBe('overdue');
  });

  it('the due-soon window scales with frequency', () => {
    const inOneDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const inFiveDays = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const inTwentyDays = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000);
    expect(checkDueStatus(inOneDay, 'weekly', now)).toBe('due_soon');
    expect(checkDueStatus(inFiveDays, 'weekly', now)).toBe('ok');
    expect(checkDueStatus(inFiveDays, 'monthly', now)).toBe('due_soon');
    expect(checkDueStatus(inTwentyDays, 'monthly', now)).toBe('ok');
    expect(checkDueStatus(inTwentyDays, 'annual', now)).toBe('due_soon');
  });
});

describe('doorInspectionIntervalMonths (FS-E06)', () => {
  const above11m = profile({ isResidential: true, heightMetres: 14 });

  it('quarterly common parts and annual flat entrance above 11 m residential', () => {
    expect(doorInspectionIntervalMonths('common_parts', above11m)).toBe(3);
    expect(doorInspectionIntervalMonths('flat_entrance', above11m)).toBe(12);
    expect(doorInspectionIntervalMonths('other', above11m)).toBe(6);
  });

  it('six-monthly default outside the regime', () => {
    const office = profile({ heightMetres: 30 });
    expect(doorInspectionIntervalMonths('common_parts', office)).toBe(6);
    expect(doorInspectionIntervalMonths('flat_entrance', office)).toBe(6);
  });

  it('a per-door override wins everywhere', () => {
    expect(doorInspectionIntervalMonths('common_parts', above11m, 1)).toBe(1);
    expect(doorInspectionIntervalMonths('other', profile(), 12)).toBe(12);
  });
});

describe('suggestedFraReviewMonths (FS-E07)', () => {
  it('tightens with the risk rating', () => {
    expect(suggestedFraReviewMonths('intolerable')).toBe(3);
    expect(suggestedFraReviewMonths('substantial')).toBe(6);
    expect(suggestedFraReviewMonths('moderate')).toBe(12);
    expect(suggestedFraReviewMonths('tolerable')).toBe(12);
    expect(suggestedFraReviewMonths(null)).toBe(12);
  });
});

describe('marshalTrainingStatus', () => {
  const now = new Date(Date.UTC(2026, 5, 1));

  it('classifies untrained, in-date, expiring-soon and expired', () => {
    expect(marshalTrainingStatus({ trainedAt: null, trainingExpiresAt: null }, now)).toBe(
      'not_trained',
    );
    expect(marshalTrainingStatus({ trainedAt: now, trainingExpiresAt: null }, now)).toBe('in_date');
    const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in90d = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const past = new Date(now.getTime() - 1000);
    expect(marshalTrainingStatus({ trainedAt: now, trainingExpiresAt: in30d }, now)).toBe(
      'expiring_soon',
    );
    expect(marshalTrainingStatus({ trainedAt: now, trainingExpiresAt: in90d }, now)).toBe(
      'in_date',
    );
    expect(marshalTrainingStatus({ trainedAt: now, trainingExpiresAt: past }, now)).toBe('expired');
  });
});

describe('checkDisplayStatus / doorDisplayStatus (FS-E08 — HSE review FS-1)', () => {
  const now = new Date(Date.UTC(2026, 7, 3));
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  it('a failed check stays "failed" even though the clock says ok', () => {
    expect(checkDisplayStatus(nextWeek, 'weekly', 'fail', now)).toBe('failed');
  });

  it('failed takes precedence over overdue — the strongest signal wins', () => {
    expect(checkDisplayStatus(yesterday, 'weekly', 'fail', now)).toBe('failed');
  });

  it('a pass or defects-found falls back to clock status', () => {
    expect(checkDisplayStatus(nextWeek, 'weekly', 'pass', now)).toBe('ok');
    expect(checkDisplayStatus(nextWeek, 'weekly', 'defects_found', now)).toBe('ok');
    expect(checkDisplayStatus(yesterday, 'weekly', 'pass', now)).toBe('overdue');
  });

  it('UXW4-03: a check nobody has performed reads neutral, never green', () => {
    // "OK" asserted an inspection nobody had made — every check on a
    // day-zero building read compliant. This does not weaken FS-1 (a fail
    // still wins over any clock state); it only refuses to claim a pass
    // that never happened.
    expect(checkDisplayStatus(nextWeek, 'weekly', null, now)).toBe('not_yet_done');
    // …and the clock still escalates it: neutral is not a hiding place.
    expect(checkDisplayStatus(yesterday, 'weekly', null, now)).toBe('overdue');
    expect(checkDisplayStatus(nextWeek, 'weekly', 'fail', now)).toBe('failed');
  });

  it('doors follow the same rule', () => {
    const in6mo = new Date(Date.UTC(2027, 1, 3));
    expect(doorDisplayStatus(in6mo, 12, 'fail', now)).toBe('failed');
    expect(doorDisplayStatus(in6mo, 12, 'pass', now)).toBe('ok');
    expect(doorDisplayStatus(yesterday, 3, null, now)).toBe('overdue');
  });
});

describe('parseDoorImport (FS-E09 — HSE review FS-12)', () => {
  it('parses ref / floor / kind lines with aliases and blank-line tolerance', () => {
    const text = 'FD-001, G, common\nFD-002\tFirst\tflat\n\nFD-003';
    const out = parseDoorImport(text, 'flat_entrance');
    expect(out.errors).toHaveLength(0);
    expect(out.rows).toEqual([
      { doorRef: 'FD-001', floor: 'G', locationKind: 'common_parts' },
      { doorRef: 'FD-002', floor: 'First', locationKind: 'flat_entrance' },
      { doorRef: 'FD-003', floor: '', locationKind: 'flat_entrance' },
    ]);
  });

  it('flags unparseable lines instead of silently defaulting', () => {
    const out = parseDoorImport(',G\nFD-9,2,cupboard', 'other');
    expect(out.rows).toHaveLength(0);
    expect(out.errors).toEqual([
      { line: 1, reason: 'empty-ref' },
      { line: 2, reason: 'bad-kind' },
    ]);
  });
});

describe('drill outcomes and door status (HSE evaluation BUG-07 / BUG-08)', () => {
  const clean = {
    rollComplete: true,
    peoplePresent: 45,
    peopleAccountedFor: 45,
    evacuationSeconds: 200,
    evacuationTargetSeconds: 360,
  };

  it('FS-A1 — a clean drill raises nothing', () => {
    expect(drillConcerns(clean)).toEqual([]);
    expect(drillNeedsFollowUp(clean)).toBe(false);
  });

  it('FS-A2 — a person unaccounted for is always a follow-up, and always high', () => {
    // The evaluation's case: 44 of 45 accounted for, a resident missed. The
    // product recorded it, satisfied the schedule, and raised nothing.
    const reasons = drillConcerns({ ...clean, peopleAccountedFor: 44 });
    expect(reasons).toContain('people_unaccounted');
    expect(drillActionPriority(reasons)).toBe('high');
  });

  it('FS-A3 — an over-target evacuation is a follow-up; no target means no time concern', () => {
    // 8m15s against a 6m target.
    expect(
      drillConcerns({ ...clean, evacuationSeconds: 495, evacuationTargetSeconds: 360 }),
    ).toContain('evacuation_over_target');
    // An organisation that has set no target gets no time-based noise.
    expect(
      drillConcerns({ ...clean, evacuationSeconds: 495, evacuationTargetSeconds: null }),
    ).toEqual([]);
  });

  it('FS-A4 — an incomplete roll is a follow-up even when no numbers were recorded', () => {
    expect(
      drillConcerns({
        rollComplete: false,
        peoplePresent: null,
        peopleAccountedFor: null,
        evacuationSeconds: null,
      }),
    ).toEqual(['roll_incomplete']);
  });

  it('FS-A5 — BUG-08: a door inspected as defects_found holds the red state', () => {
    // The next inspection is not due for months, so the due-date branch would
    // return "ok" — which is exactly what shipped, with the defects sitting in
    // the history and the register showing green.
    const now = new Date('2026-08-15T00:00:00Z');
    const notDueYet = new Date('2027-02-15T00:00:00Z');
    expect(doorDisplayStatus(notDueYet, 6, 'defects_found', now)).toBe('failed');
    expect(doorDisplayStatus(notDueYet, 6, 'fail', now)).toBe('failed');
    // And a later pass is what clears it.
    expect(doorDisplayStatus(notDueYet, 6, 'pass', now)).toBe('ok');
  });
});
