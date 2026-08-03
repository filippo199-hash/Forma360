import { describe, expect, it } from 'vitest';
import {
  ALERT_KINDS,
  canTransition,
  CONFIDENTIAL_BY_DEFAULT_KINDS,
  defaultConfidential,
  defaultInvestigationLevel,
  effectivenessDueAt,
  formatIncidentReference,
  INCIDENT_KINDS,
  INCIDENT_STATUSES,
  type IncidentStatus,
  isLateReport,
  isOpenIncidentStatus,
  isRiddorReportable,
  needsImmediateAlert,
  needsRiddorRescreen,
  overSevenDayTripwire,
  parseIncidentDetails,
  personInjurySchema,
  riddorDeadlineFor,
  totalDaysLost,
  whyChainSchema,
} from './incidents';

const DAY_MS = 86_400_000;

describe('IN-E01 — lifecycle matrix', () => {
  const allowed: Record<IncidentStatus, ReadonlyArray<IncidentStatus>> = {
    reported: ['triaged', 'cancelled'],
    triaged: ['investigating', 'cancelled'],
    investigating: ['actions_outstanding', 'cancelled'],
    actions_outstanding: ['closed', 'cancelled'],
    closed: ['reopened'],
    reopened: ['investigating', 'cancelled'],
    cancelled: [],
  };

  it('permits exactly the documented transitions and refuses everything else', () => {
    for (const from of INCIDENT_STATUSES) {
      for (const to of INCIDENT_STATUSES) {
        const expected = allowed[from].includes(to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });

  it('terminal cancelled has no exits; closed can only reopen', () => {
    expect(INCIDENT_STATUSES.every((to) => !canTransition('cancelled', to))).toBe(true);
    expect(canTransition('closed', 'reopened')).toBe(true);
    expect(canTransition('closed', 'investigating')).toBe(false);
  });

  it('classifies open vs terminal statuses', () => {
    expect(isOpenIncidentStatus('reported')).toBe(true);
    expect(isOpenIncidentStatus('reopened')).toBe(true);
    expect(isOpenIncidentStatus('closed')).toBe(false);
    expect(isOpenIncidentStatus('cancelled')).toBe(false);
  });
});

describe('IN-E02 — late-report flag', () => {
  const occurred = new Date('2026-08-01T08:00:00Z');

  it('is not late at exactly 24 hours', () => {
    expect(isLateReport(occurred, new Date(occurred.getTime() + 24 * 3_600_000))).toBe(false);
  });

  it('is late one millisecond past 24 hours', () => {
    expect(isLateReport(occurred, new Date(occurred.getTime() + 24 * 3_600_000 + 1))).toBe(true);
  });
});

describe('IN-E03 — per-kind details validation', () => {
  it('round-trips a sharps exposure block with defaults applied', () => {
    const parsed = parseIncidentDetails('sharps_exposure', { device: 'Used cannula' });
    expect(parsed).toMatchObject({
      device: 'Used cannula',
      ohFollowUpRequired: true,
      contaminationStatus: 'unknown',
      sourceKnown: false,
    });
  });

  it('round-trips a violence & aggression block', () => {
    const parsed = parseIncidentDetails('violence_aggression', {
      nature: 'physical',
      perpetratorType: 'visitor',
      policeNotified: true,
      crimeReference: 'CR/1234/26',
    });
    expect(parsed).toMatchObject({ nature: 'physical', policeNotified: true });
  });

  it('requires free text when a dangerous occurrence is categorised as other', () => {
    expect(() => parseIncidentDetails('dangerous_occurrence', { category: 'other' })).toThrow();
    expect(
      parseIncidentDetails('dangerous_occurrence', {
        category: 'other',
        otherText: 'Runaway trolley',
      }),
    ).toMatchObject({ category: 'other' });
  });

  it('accepts an empty block for injury kinds (substance lives on the person rows)', () => {
    expect(parseIncidentDetails('injury', {})).toEqual({});
    expect(parseIncidentDetails('injury', undefined)).toEqual({});
  });

  it('rejects unknown keys (strict schemas)', () => {
    expect(() => parseIncidentDetails('injury', { surprise: true })).toThrow();
    expect(() =>
      parseIncidentDetails('damage', { whatDamaged: 'Forklift', patientId: 'x' }),
    ).toThrow();
  });

  it('refuses an unknown kind outright', () => {
    expect(() => parseIncidentDetails('patient_safety', {})).toThrow(/unknown-incident-kind/);
  });

  it('validates the per-person injury block', () => {
    const parsed = personInjurySchema.parse({
      bodyParts: ['hand', 'finger'],
      injuryKinds: ['laceration'],
      firstAidGiven: true,
      firstAidBy: 'Site first aider',
    });
    expect(parsed.hospitalisation).toBe('none');
    expect(() => personInjurySchema.parse({ bodyParts: ['spleen'] })).toThrow();
  });
});

describe('IN-E04 — lost-days calculator (RIDDOR counting rule)', () => {
  // Accident on Friday 2026-07-31; absence starts same day.
  const occurred = '2026-07-31';

  it('excludes the day of the accident and counts the weekend', () => {
    // Off from the accident day through the following Wednesday inclusive:
    // 31 Jul (excluded), 1, 2 (weekend), 3, 4, 5 Aug = 5 days lost.
    const days = totalDaysLost(
      [{ fromDate: '2026-07-31', toDate: '2026-08-05' }],
      occurred,
      '2026-08-31',
    );
    expect(days).toBe(5);
  });

  it('accumulates across multiple periods', () => {
    const days = totalDaysLost(
      [
        { fromDate: '2026-08-01', toDate: '2026-08-03' }, // 3
        { fromDate: '2026-08-10', toDate: '2026-08-12' }, // 3
      ],
      occurred,
      '2026-08-31',
    );
    expect(days).toBe(6);
  });

  it('does not double-count overlapping periods', () => {
    const days = totalDaysLost(
      [
        { fromDate: '2026-08-01', toDate: '2026-08-05' },
        { fromDate: '2026-08-04', toDate: '2026-08-08' },
      ],
      occurred,
      '2026-08-31',
    );
    expect(days).toBe(8); // 1..8 Aug merged
  });

  it('counts an open-ended period up to the as-of date', () => {
    const days = totalDaysLost([{ fromDate: '2026-08-01', toDate: null }], occurred, '2026-08-04');
    expect(days).toBe(4);
  });

  it('ignores periods that have not started and inverted periods', () => {
    expect(totalDaysLost([{ fromDate: '2026-09-01', toDate: null }], occurred, '2026-08-15')).toBe(
      0,
    );
    expect(
      totalDaysLost([{ fromDate: '2026-08-10', toDate: '2026-08-05' }], occurred, '2026-08-31'),
    ).toBe(0);
  });

  it('rejects malformed dates loudly', () => {
    expect(() =>
      totalDaysLost([{ fromDate: '31/07/2026', toDate: null }], occurred, '2026-08-31'),
    ).toThrow(/invalid-iso-date/);
  });
});

describe('IN-E05 — over-7-day tripwire', () => {
  const occurred = '2026-07-31';

  it('stays quiet at exactly 7 days and fires at 8', () => {
    const seven = [{ fromDate: '2026-08-01', toDate: '2026-08-07' }];
    const eight = [{ fromDate: '2026-08-01', toDate: '2026-08-08' }];
    expect(overSevenDayTripwire(seven, occurred, '2026-08-31')).toBe(false);
    expect(overSevenDayTripwire(eight, occurred, '2026-08-31')).toBe(true);
  });

  it('fires as an open absence accumulates past 7 days', () => {
    const open = [{ fromDate: '2026-08-01', toDate: null }];
    expect(overSevenDayTripwire(open, occurred, '2026-08-07')).toBe(false);
    expect(overSevenDayTripwire(open, occurred, '2026-08-09')).toBe(true);
  });

  it('flags re-screening only against a not-reportable determination', () => {
    expect(needsRiddorRescreen('not_reportable', 8)).toBe(true);
    expect(needsRiddorRescreen('not_reportable', 7)).toBe(false);
    expect(needsRiddorRescreen('over_7_day', 12)).toBe(false);
    expect(needsRiddorRescreen(null, 12)).toBe(false);
  });
});

describe('IN-E06 — RIDDOR deadline computation', () => {
  const occurred = new Date('2026-08-01T10:00:00Z');

  it('gives 10 days for death / specified injury / dangerous occurrence / gas', () => {
    for (const category of [
      'death',
      'specified_injury',
      'dangerous_occurrence',
      'gas_incident',
    ] as const) {
      const deadline = riddorDeadlineFor(category, occurred);
      expect(deadline?.getTime()).toBe(occurred.getTime() + 10 * DAY_MS);
    }
  });

  it('gives 15 days for over-7-day injuries', () => {
    expect(riddorDeadlineFor('over_7_day', occurred)?.getTime()).toBe(
      occurred.getTime() + 15 * DAY_MS,
    );
  });

  it('gives no deadline for a negative determination', () => {
    expect(riddorDeadlineFor('not_reportable', occurred)).toBeNull();
  });

  it('classifies reportability', () => {
    expect(isRiddorReportable('not_reportable')).toBe(false);
    expect(isRiddorReportable('over_7_day')).toBe(true);
  });
});

describe('immediate-alert routing', () => {
  it('fires for serious severity regardless of kind', () => {
    expect(needsImmediateAlert('injury', 'serious')).toBe(true);
    expect(needsImmediateAlert('injury', 'moderate')).toBe(false);
  });

  it('always fires for the alert kinds', () => {
    for (const kind of ALERT_KINDS) {
      expect(needsImmediateAlert(kind, 'negligible')).toBe(true);
    }
  });
});

describe('confidentiality defaults', () => {
  it('defaults sharps and violence records to confidential', () => {
    for (const kind of CONFIDENTIAL_BY_DEFAULT_KINDS) {
      expect(defaultConfidential(kind)).toBe(true);
    }
    expect(defaultConfidential('injury')).toBe(false);
  });
});

describe('investigation level defaults', () => {
  it('defaults to full for serious severity or a reportable determination', () => {
    expect(defaultInvestigationLevel('serious', false)).toBe('full');
    expect(defaultInvestigationLevel('minor', true)).toBe('full');
    expect(defaultInvestigationLevel('minor', false)).toBe('basic');
  });
});

describe('why-chain validation', () => {
  it('requires 2–7 entries', () => {
    expect(() => whyChainSchema.parse([{ text: 'only one' }])).toThrow();
    expect(
      whyChainSchema.parse([{ text: 'why one' }, { text: 'why two', isRootCause: true }]),
    ).toHaveLength(2);
  });

  it('allows at most one root cause and only on the last entry', () => {
    expect(() =>
      whyChainSchema.parse([
        { text: 'a', isRootCause: true },
        { text: 'b', isRootCause: true },
      ]),
    ).toThrow(/multiple-root-causes/);
    expect(() => whyChainSchema.parse([{ text: 'a', isRootCause: true }, { text: 'b' }])).toThrow(
      /root-cause-not-last/,
    );
  });
});

describe('effectiveness scheduling', () => {
  const closed = new Date('2026-08-01T00:00:00Z');

  it('defaults to +90 days and clamps into the 30–365 window', () => {
    expect(effectivenessDueAt(closed).getTime()).toBe(closed.getTime() + 90 * DAY_MS);
    expect(effectivenessDueAt(closed, 5).getTime()).toBe(closed.getTime() + 30 * DAY_MS);
    expect(effectivenessDueAt(closed, 9000).getTime()).toBe(closed.getTime() + 365 * DAY_MS);
  });
});

describe('IN-E19 — reference continuity', () => {
  it('pads to six digits and grows past IN-999999 without truncation', () => {
    expect(formatIncidentReference(1)).toBe('IN-000001');
    expect(formatIncidentReference(999_999)).toBe('IN-999999');
    expect(formatIncidentReference(1_000_000)).toBe('IN-1000000');
  });
});

describe('kind catalogue', () => {
  it('ships the eight kinds from the spec', () => {
    expect(new Set(INCIDENT_KINDS)).toEqual(
      new Set([
        'injury',
        'ill_health',
        'dangerous_occurrence',
        'sharps_exposure',
        'violence_aggression',
        'damage',
        'environmental',
        'near_miss',
      ]),
    );
  });
});
