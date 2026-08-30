/**
 * PW-CL01..CL05 — the issue-readiness checklist derives exactly the
 * rows the permit type imposes, with the same verdicts the server's
 * issue gate reaches (shared helpers; server-computed slugs passed
 * through untouched).
 */
import { describe, expect, it } from 'vitest';
import { buildPermitIssueChecklist } from './issue-checklist';

const NOW = new Date('2026-08-16T12:00:00.000Z');

function baseInput() {
  return {
    now: NOW,
    validFrom: new Date('2026-08-16T13:00:00.000Z'),
    validTo: new Date('2026-08-16T17:00:00.000Z'),
    maxDurationHours: 8,
    acceptorNamed: true,
    preconditions: [{ checked: true }, { checked: true }],
    gas: null,
    isolationRequired: false,
    isolationSatisfied: false,
    rescueRequired: false,
    rescueSatisfied: false,
    authoriserRequired: false,
    authorised: false,
    riskAssessmentRequired: false,
    riskAssessmentGate: null,
    ramsRequired: false,
    ramsGate: null,
    requiredTrainingCount: 0,
    trainingShortfallCount: 0,
    conflictCount: 0,
    conflictsAcknowledged: false,
  };
}

describe('buildPermitIssueChecklist', () => {
  it('PW-CL01: a minimal ready permit shows window + acceptor + preconditions, all done', () => {
    const items = buildPermitIssueChecklist(baseInput());
    expect(items.map((i) => i.key)).toEqual(['window', 'acceptor', 'preconditions']);
    expect(items.every((i) => i.done)).toBe(true);
    expect(items.find((i) => i.key === 'preconditions')?.count).toEqual({ done: 2, total: 2 });
  });

  it('PW-CL02: rows appear only for requirements the type imposes', () => {
    const items = buildPermitIssueChecklist({
      ...baseInput(),
      gas: { requiresGasTesting: true, limits: [], maxAgeMinutes: 60, readings: [] },
      isolationRequired: true,
      rescueRequired: true,
      authoriserRequired: true,
      riskAssessmentRequired: true,
      riskAssessmentGate: 'risk-assessment-required',
      ramsRequired: true,
      ramsGate: 'rams-pack-required',
      requiredTrainingCount: 2,
      trainingShortfallCount: 1,
      conflictCount: 1,
    });
    expect(items.map((i) => i.key)).toEqual([
      'window',
      'acceptor',
      'preconditions',
      'gasTest',
      'isolation',
      'rescuePlan',
      'authorisation',
      'riskAssessment',
      'ramsPack',
      'training',
      'conflicts',
    ]);
    const byKey = new Map(items.map((i) => [i.key, i]));
    expect(byKey.get('gasTest')).toMatchObject({ done: false, reason: 'gas-test-required' });
    expect(byKey.get('riskAssessment')).toMatchObject({
      done: false,
      reason: 'risk-assessment-required',
    });
    expect(byKey.get('ramsPack')).toMatchObject({ done: false, reason: 'rams-pack-required' });
    expect(byKey.get('training')?.done).toBe(false);
    expect(byKey.get('conflicts')?.done).toBe(false);
  });

  it('PW-CL03: a window already past is not issuable even when internally valid', () => {
    const items = buildPermitIssueChecklist({
      ...baseInput(),
      validFrom: new Date('2026-08-15T08:00:00.000Z'),
      validTo: new Date('2026-08-15T12:00:00.000Z'),
    });
    expect(items.find((i) => i.key === 'window')).toMatchObject({
      done: false,
      reason: 'window-past',
    });
  });

  it('PW-CL04: acknowledged conflicts flip that row done; fresh in-range gas passes', () => {
    const items = buildPermitIssueChecklist({
      ...baseInput(),
      gas: {
        requiresGasTesting: true,
        limits: [],
        maxAgeMinutes: 60,
        readings: [
          {
            id: 'r1',
            limitId: null,
            substance: 'O2',
            value: 20.9,
            unit: 'percent',
            takenAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
            takenBy: 'usr_x',
            verdict: 'pass',
          },
        ] as never,
      },
      conflictCount: 2,
      conflictsAcknowledged: true,
    });
    expect(items.find((i) => i.key === 'gasTest')?.done).toBe(true);
    expect(items.find((i) => i.key === 'conflicts')?.done).toBe(true);
  });

  it('PW-CL05: partial preconditions carry their progress count', () => {
    const items = buildPermitIssueChecklist({
      ...baseInput(),
      preconditions: [{ checked: true }, { checked: false }, { checked: false }],
    });
    expect(items.find((i) => i.key === 'preconditions')).toMatchObject({
      done: false,
      count: { done: 1, total: 3 },
    });
  });
});
