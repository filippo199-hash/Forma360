/**
 * Unit tests for the permit-to-work domain helpers (FreeHS module B3).
 *
 * Edge cases covered (module-level IDs; see the permits router tests for
 * PW-E10+ and the expiry-watch worker tests for PW-J01/J02):
 *   - PW-E01: lifecycle transition matrix — every legal move allowed,
 *     terminal states allow nothing, handover's active → issued drop is
 *     legal, draft → active is not
 *   - PW-E02: validity-window overlap is strict — touching windows do not
 *     overlap, containment and partial overlap do
 *   - PW-E03: the default permit-type catalogue covers all nine high-risk
 *     categories exactly once, with unique non-empty preconditions and
 *     sane duration caps
 *   - PW-E04: overdue = open status AND past validTo; closed/cancelled or
 *     future permits are never overdue
 *   - PW-E05: precondition snapshot/completion helpers and the validity
 *     window validator (inverted and over-cap windows refused)
 *   - PW-E06: readingWithinLimit — inclusive bounds, null sides, unit
 *     mismatch never passes (HSE review PW-1)
 *   - PW-E07: gasGateError — missing / out-of-range / stale precedence,
 *     per-limit latest-reading evaluation, takenAfter re-test cut,
 *     presence+freshness fallback for limit-less types (PW-1 / PW-3)
 *   - PW-E08: sameAreaMatch — token reorder and subset match, negatives,
 *     empty never matches (PW-14)
 *   - PW-E09: seeded gas limits — gas-requiring defaults carry evaluable
 *     limits, confined space gets the 30-minute freshness window; the
 *     open-entry counter (PW-8)
 *   - PW-E11: ramsGateError — own-pack status, third-party acceptance
 *     outcome and validity window, and the no-link case; pure so the
 *     permit page previews the blocker before Issue (RS-A11)
 */
import { describe, expect, it } from 'vitest';
import {
  allPreconditionsChecked,
  canTransition,
  closureComplete,
  DEFAULT_GAS_TEST_MAX_AGE_MINUTES,
  DEFAULT_PERMIT_TYPES,
  gasGateError,
  isOpenPermitStatus,
  OPEN_PERMIT_STATUSES,
  openEntryCount,
  overlaps,
  PERMIT_CATEGORIES,
  PERMIT_STATUSES,
  permitIsOverdue,
  ramsGateError,
  trainingGateError,
  trainingGateShortfalls,
  type TrainingGateFact,
  readingWithinLimit,
  sameAreaMatch,
  snapshotPreconditions,
  validityWindowError,
  type GasLimit,
  type GasReading,
  type PermitRamsLink,
} from './permits';

describe('canTransition (PW-E01)', () => {
  it('allows the documented lifecycle moves', () => {
    expect(canTransition('draft', 'issued')).toBe(true);
    expect(canTransition('draft', 'cancelled')).toBe(true);
    expect(canTransition('issued', 'active')).toBe(true);
    expect(canTransition('issued', 'cancelled')).toBe(true);
    expect(canTransition('issued', 'closed')).toBe(true);
    expect(canTransition('active', 'suspended')).toBe(true);
    expect(canTransition('active', 'closed')).toBe(true);
    expect(canTransition('active', 'cancelled')).toBe(true);
    // Shift handover: the permit falls back to issued until the incoming
    // acceptor signs on.
    expect(canTransition('active', 'issued')).toBe(true);
    expect(canTransition('suspended', 'active')).toBe(true);
    expect(canTransition('suspended', 'closed')).toBe(true);
    expect(canTransition('suspended', 'cancelled')).toBe(true);
  });

  it('refuses illegal moves and terminal-state exits', () => {
    expect(canTransition('draft', 'active')).toBe(false);
    expect(canTransition('draft', 'suspended')).toBe(false);
    expect(canTransition('draft', 'closed')).toBe(false);
    expect(canTransition('suspended', 'issued')).toBe(false);
    for (const to of PERMIT_STATUSES) {
      expect(canTransition('closed', to)).toBe(false);
      expect(canTransition('cancelled', to)).toBe(false);
    }
  });

  it('PW-A1 — issued → draft is legal: it is refusal, not cancellation', () => {
    // The acceptor sends the permit BACK to the issuer for correction.
    // Without this the only way to decline was to cancel, which kills
    // the record rather than bouncing it.
    expect(canTransition('issued', 'draft')).toBe(true);
    // ...and it is the only way back to draft. Nothing that has been
    // worked reopens for editing.
    expect(canTransition('active', 'draft')).toBe(false);
    expect(canTransition('suspended', 'draft')).toBe(false);
    expect(canTransition('closed', 'draft')).toBe(false);
  });

  it('open statuses are exactly issued / active / suspended', () => {
    expect([...OPEN_PERMIT_STATUSES].sort()).toEqual(['active', 'issued', 'suspended']);
    expect(isOpenPermitStatus('draft')).toBe(false);
    expect(isOpenPermitStatus('active')).toBe(true);
    expect(isOpenPermitStatus('closed')).toBe(false);
  });
});

describe('overlaps (PW-E02)', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h));

  it('detects partial overlap and containment', () => {
    expect(overlaps(at(8), at(12), at(10), at(14))).toBe(true);
    expect(overlaps(at(8), at(16), at(10), at(12))).toBe(true);
    expect(overlaps(at(10), at(12), at(8), at(16))).toBe(true);
  });

  it('touching windows do not overlap; disjoint windows do not overlap', () => {
    expect(overlaps(at(8), at(12), at(12), at(16))).toBe(false);
    expect(overlaps(at(12), at(16), at(8), at(12))).toBe(false);
    expect(overlaps(at(8), at(10), at(14), at(16))).toBe(false);
  });
});

describe('DEFAULT_PERMIT_TYPES (PW-E03)', () => {
  it('covers all nine high-risk categories exactly once', () => {
    const cats = DEFAULT_PERMIT_TYPES.map((t) => t.category);
    expect(cats).toHaveLength(9);
    expect(new Set(cats).size).toBe(9);
    // Every non-'other' category from the catalogue is seeded.
    const expected = PERMIT_CATEGORIES.filter((c) => c !== 'other');
    expect([...cats].sort()).toEqual([...expected].sort());
  });

  it('every seeded type has unique, non-empty preconditions and a sane cap', () => {
    for (const t of DEFAULT_PERMIT_TYPES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.preconditions.length).toBeGreaterThanOrEqual(4);
      const ids = t.preconditions.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const p of t.preconditions) {
        expect(p.label.length).toBeGreaterThan(0);
      }
      expect(t.maxDurationHours).toBeGreaterThanOrEqual(4);
      expect(t.maxDurationHours).toBeLessThanOrEqual(24);
    }
  });

  it('the highest-hazard categories require an authorising signature', () => {
    const byCat = new Map(DEFAULT_PERMIT_TYPES.map((t) => [t.category, t]));
    expect(byCat.get('confined_space')?.requiresAuthoriser).toBe(true);
    expect(byCat.get('electrical')?.requiresAuthoriser).toBe(true);
    // Hot work is the permit every insurer expects to carry a named
    // authorisation, and it shipped without one — an issued hot-work
    // permit had an issuer and an acceptor and nobody who authorised
    // the ignition source.
    expect(byCat.get('hot_work')?.requiresAuthoriser).toBe(true);
    expect(byCat.get('confined_space')?.requiresGasTesting).toBe(true);
    expect(byCat.get('hot_work')?.requiresGasTesting).toBe(true);
    // Sprinklers and detection are the hot-work precondition most often
    // missed and most often expensive: heat from a weld sets off the
    // head above it, and the informal "fix" is isolating the system.
    expect(
      byCat.get('hot_work')?.preconditions.some((p) => p.id === 'detection_suppression'),
    ).toBe(true);
    expect(byCat.get('confined_space')?.requiresRescuePlan).toBe(true);
    expect(byCat.get('work_at_height')?.requiresRescuePlan).toBe(true);
  });
});

describe('permitIsOverdue (PW-E04)', () => {
  const now = new Date('2026-08-01T12:00:00Z');
  const past = new Date('2026-08-01T11:00:00Z');
  const future = new Date('2026-08-01T13:00:00Z');

  it('open permits past validTo are overdue', () => {
    expect(permitIsOverdue({ status: 'issued', validTo: past }, now)).toBe(true);
    expect(permitIsOverdue({ status: 'active', validTo: past }, now)).toBe(true);
    expect(permitIsOverdue({ status: 'suspended', validTo: past }, now)).toBe(true);
  });

  it('closed, cancelled, draft or future permits are not overdue', () => {
    expect(permitIsOverdue({ status: 'closed', validTo: past }, now)).toBe(false);
    expect(permitIsOverdue({ status: 'cancelled', validTo: past }, now)).toBe(false);
    expect(permitIsOverdue({ status: 'draft', validTo: past }, now)).toBe(false);
    expect(permitIsOverdue({ status: 'active', validTo: future }, now)).toBe(false);
    expect(permitIsOverdue({ status: 'active', validTo: now }, now)).toBe(false);
  });
});

describe('preconditions + validity window (PW-E05)', () => {
  it('snapshotPreconditions copies definitions into unchecked state', () => {
    const snap = snapshotPreconditions([
      { id: 'a', label: 'Area cleared' },
      { id: 'b', label: 'Extinguisher present' },
    ]);
    expect(snap).toHaveLength(2);
    for (const s of snap) {
      expect(s.checked).toBe(false);
      expect(s.checkedBy).toBeNull();
      expect(s.checkedAt).toBeNull();
      expect(s.note).toBe('');
    }
    expect(snap[0]?.label).toBe('Area cleared');
  });

  it('allPreconditionsChecked requires every item checked (empty list passes)', () => {
    const snap = snapshotPreconditions([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
    expect(allPreconditionsChecked(snap)).toBe(false);
    const half = snap.map((s, i) => (i === 0 ? { ...s, checked: true } : s));
    expect(allPreconditionsChecked(half)).toBe(false);
    const all = snap.map((s) => ({ ...s, checked: true }));
    expect(allPreconditionsChecked(all)).toBe(true);
    expect(allPreconditionsChecked([])).toBe(true);
  });

  it('validityWindowError refuses inverted and over-cap windows', () => {
    const from = new Date('2026-08-01T08:00:00Z');
    const to = new Date('2026-08-01T16:00:00Z');
    expect(validityWindowError(from, to, 12)).toBeNull();
    expect(validityWindowError(to, from, 12)).toBe('window-invalid');
    expect(validityWindowError(from, from, 12)).toBe('window-invalid');
    // 8h window against a 6h cap.
    expect(validityWindowError(from, to, 6)).toBe('window-too-long');
    // Exactly at the cap is fine.
    expect(validityWindowError(from, to, 8)).toBeNull();
  });

  it('closureComplete requires all four checks', () => {
    expect(
      closureComplete({
        workComplete: true,
        areaMadeSafe: true,
        isolationsRemoved: true,
        personnelClear: true,
      }),
    ).toBe(true);
    expect(
      closureComplete({
        workComplete: true,
        areaMadeSafe: true,
        isolationsRemoved: false,
        personnelClear: true,
      }),
    ).toBe(false);
  });
});

describe('readingWithinLimit (PW-E06)', () => {
  const o2: GasLimit = { id: 'oxygen', label: 'O₂', unit: 'percent_o2', min: 19.5, max: 23.5 };
  const lel: GasLimit = { id: 'lel', label: 'LEL', unit: 'percent_lel', min: null, max: 10 };

  it('bounds are inclusive; null sides are unbounded', () => {
    expect(readingWithinLimit({ reading: 20.9, unit: 'percent_o2' }, o2)).toBe(true);
    expect(readingWithinLimit({ reading: 19.5, unit: 'percent_o2' }, o2)).toBe(true);
    expect(readingWithinLimit({ reading: 23.5, unit: 'percent_o2' }, o2)).toBe(true);
    expect(readingWithinLimit({ reading: 19.4, unit: 'percent_o2' }, o2)).toBe(false);
    expect(readingWithinLimit({ reading: 23.6, unit: 'percent_o2' }, o2)).toBe(false);
    expect(readingWithinLimit({ reading: 0, unit: 'percent_lel' }, lel)).toBe(true);
    expect(readingWithinLimit({ reading: 10, unit: 'percent_lel' }, lel)).toBe(true);
    expect(readingWithinLimit({ reading: 90, unit: 'percent_lel' }, lel)).toBe(false);
  });

  it('a unit mismatch never passes', () => {
    expect(readingWithinLimit({ reading: 20.9, unit: 'ppm' }, o2)).toBe(false);
  });
});

describe('gasGateError (PW-E07)', () => {
  const NOW = new Date('2026-08-02T12:00:00Z');
  const o2: GasLimit = { id: 'oxygen', label: 'O₂', unit: 'percent_o2', min: 19.5, max: 23.5 };
  const lel: GasLimit = { id: 'lel', label: 'LEL', unit: 'percent_lel', min: null, max: 10 };

  function reading(patch: Partial<GasReading>): GasReading {
    return {
      id: 'r1',
      substance: 'O₂',
      reading: 20.9,
      unit: 'percent_o2',
      takenAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
      takenBy: 'usr_x',
      takenByName: 'Tess Tester',
      note: '',
      limitId: 'oxygen',
      withinLimits: true,
      ...patch,
    };
  }

  it('passes only when every limit has a fresh, in-range latest reading', () => {
    const good = [
      reading({ id: 'a' }),
      reading({ id: 'b', limitId: 'lel', unit: 'percent_lel', reading: 2 }),
    ];
    expect(
      gasGateError({
        requiresGasTesting: true,
        limits: [o2, lel],
        maxAgeMinutes: 30,
        readings: good,
        now: NOW,
      }),
    ).toBeNull();

    // One limit with no reading at all → required.
    expect(
      gasGateError({
        requiresGasTesting: true,
        limits: [o2, lel],
        maxAgeMinutes: 30,
        readings: [reading({})],
        now: NOW,
      }),
    ).toBe('gas-test-required');
  });

  it('a dangerous LATEST reading blocks even if an older one was safe', () => {
    const readings = [
      reading({ id: 'old', takenAt: new Date(NOW.getTime() - 20 * 60_000).toISOString() }),
      reading({
        id: 'new',
        reading: 17,
        takenAt: new Date(NOW.getTime() - 2 * 60_000).toISOString(),
      }),
    ];
    expect(
      gasGateError({
        requiresGasTesting: true,
        limits: [o2],
        maxAgeMinutes: 30,
        readings,
        now: NOW,
      }),
    ).toBe('gas-test-out-of-range');
  });

  it('a stale latest reading blocks; missing beats out-of-range beats stale', () => {
    const stale = [reading({ takenAt: new Date(NOW.getTime() - 45 * 60_000).toISOString() })];
    expect(
      gasGateError({
        requiresGasTesting: true,
        limits: [o2],
        maxAgeMinutes: 30,
        readings: stale,
        now: NOW,
      }),
    ).toBe('gas-test-stale');

    // Missing on one limit + out-of-range on another → required wins.
    expect(
      gasGateError({
        requiresGasTesting: true,
        limits: [o2, lel],
        maxAgeMinutes: 30,
        readings: [reading({ reading: 17 })],
        now: NOW,
      }),
    ).toBe('gas-test-required');
  });

  it('takenAfter discards pre-suspension readings — resume needs a re-test', () => {
    const suspendedAt = new Date(NOW.getTime() - 10 * 60_000);
    const before = [reading({ takenAt: new Date(NOW.getTime() - 15 * 60_000).toISOString() })];
    expect(
      gasGateError({
        requiresGasTesting: true,
        limits: [o2],
        maxAgeMinutes: 30,
        readings: before,
        now: NOW,
        takenAfter: suspendedAt,
      }),
    ).toBe('gas-test-required');

    const after = [...before, reading({ id: 'fresh' })];
    expect(
      gasGateError({
        requiresGasTesting: true,
        limits: [o2],
        maxAgeMinutes: 30,
        readings: after,
        now: NOW,
        takenAfter: suspendedAt,
      }),
    ).toBeNull();
  });

  it('limit-less types need presence + freshness; non-gas types skip entirely', () => {
    expect(
      gasGateError({
        requiresGasTesting: true,
        limits: [],
        maxAgeMinutes: 30,
        readings: [],
        now: NOW,
      }),
    ).toBe('gas-test-required');
    expect(
      gasGateError({
        requiresGasTesting: true,
        limits: [],
        maxAgeMinutes: 30,
        readings: [reading({ limitId: null, withinLimits: null })],
        now: NOW,
      }),
    ).toBeNull();
    expect(
      gasGateError({
        requiresGasTesting: false,
        limits: [o2],
        maxAgeMinutes: 30,
        readings: [],
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe('sameAreaMatch (PW-E08)', () => {
  it('matches reordered wording and punctuation differences', () => {
    expect(sameAreaMatch('Bay 4, tank farm', 'Tank farm bay 4')).toBe(true);
    expect(sameAreaMatch('MCC Room', 'mcc room')).toBe(true);
  });

  it('matches when one description is a subset of the other', () => {
    expect(sameAreaMatch('bay 4', 'tank farm bay 4')).toBe(true);
  });

  it('different areas and empty text do not match', () => {
    expect(sameAreaMatch('bay 4', 'bay 5')).toBe(false);
    expect(sameAreaMatch('', 'bay 4')).toBe(false);
    expect(sameAreaMatch('', '')).toBe(false);
  });
});

describe('seeded gas limits + entry counter (PW-E09)', () => {
  it('every gas-requiring seeded type carries evaluable limits', () => {
    for (const t of DEFAULT_PERMIT_TYPES) {
      if (t.requiresGasTesting) {
        expect(t.gasLimits.length, t.category).toBeGreaterThan(0);
        const ids = t.gasLimits.map((l) => l.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
      expect(t.gasTestMaxAgeMinutes).toBeGreaterThan(0);
    }
    const confined = DEFAULT_PERMIT_TYPES.find((t) => t.category === 'confined_space');
    expect(confined?.gasTestMaxAgeMinutes).toBe(30);
    const hot = DEFAULT_PERMIT_TYPES.find((t) => t.category === 'hot_work');
    expect(hot?.gasTestMaxAgeMinutes).toBe(DEFAULT_GAS_TEST_MAX_AGE_MINUTES);
    expect(confined?.gasLimits.some((l) => l.unit === 'percent_o2' && l.min === 19.5)).toBe(true);
  });

  it('openEntryCount counts only rows without an exit', () => {
    expect(
      openEntryCount([
        { exitedAt: null },
        { exitedAt: '2026-08-02T10:00:00Z' },
        { exitedAt: null },
      ]),
    ).toBe(2);
    expect(openEntryCount([])).toBe(0);
  });
});

describe('ramsGateError (PW-E11 / RS-A11)', () => {
  const now = new Date('2026-08-04T10:00:00Z');
  const gate = (link: PermitRamsLink, requiresRamsPack = true) =>
    ramsGateError({ requiresRamsPack, link, now });

  it('never blocks a type that does not require a pack', () => {
    expect(gate(null, false)).toBeNull();
    expect(gate({ kind: 'own_pack', packStatus: 'draft' }, false)).toBeNull();
  });

  it('demands a link when the type requires one', () => {
    expect(gate(null)).toBe('rams-pack-required');
  });

  it('accepts an own pack only while it is issued', () => {
    expect(gate({ kind: 'own_pack', packStatus: 'issued' })).toBeNull();
    for (const status of ['draft', 'ready', 'withdrawn', 'superseded', 'archived']) {
      expect(gate({ kind: 'own_pack', packStatus: status }), status).toBe('rams-pack-not-issued');
    }
  });

  it('accepts a third-party review on either accepted outcome', () => {
    const base = { kind: 'third_party_review', validFrom: null, validTo: null } as const;
    expect(gate({ ...base, outcome: 'accepted' })).toBeNull();
    expect(gate({ ...base, outcome: 'accepted_with_conditions' })).toBeNull();
    expect(gate({ ...base, outcome: 'pending' })).toBe('rams-acceptance-expired');
    expect(gate({ ...base, outcome: 'rejected' })).toBe('rams-acceptance-expired');
  });

  it('refuses an acceptance outside its validity window (RS-E13)', () => {
    const accepted = { kind: 'third_party_review', outcome: 'accepted' } as const;
    // Not yet in force.
    expect(gate({ ...accepted, validFrom: new Date('2026-08-05T00:00:00Z'), validTo: null })).toBe(
      'rams-acceptance-expired',
    );
    // Lapsed.
    expect(gate({ ...accepted, validFrom: null, validTo: new Date('2026-08-03T00:00:00Z') })).toBe(
      'rams-acceptance-expired',
    );
    // Inside the window.
    expect(
      gate({
        ...accepted,
        validFrom: new Date('2026-08-01T00:00:00Z'),
        validTo: new Date('2026-08-31T00:00:00Z'),
      }),
    ).toBeNull();
  });
});

describe('trainingGateError (PW-E12 / FreeHS B7)', () => {
  const fact = (
    personLabel: string,
    requirementId: string,
    status: TrainingGateFact['status'],
  ): TrainingGateFact => ({
    personLabel,
    requirementId,
    requirementName: `Req ${requirementId}`,
    status,
  });

  it('PW-E12: a type with no required training never blocks', () => {
    expect(
      trainingGateError({
        requiredTrainingIds: [],
        facts: [fact('Dave', 'r1', 'expired')],
      }),
    ).toBeNull();
  });

  it('PW-E12: expired and never-held block; expiring_soon does not', () => {
    // The card is valid today — a shift-long permit must not fail because
    // a ticket lapses next month.
    expect(
      trainingGateError({
        requiredTrainingIds: ['r1'],
        facts: [fact('Dave', 'r1', 'expiring_soon')],
      }),
    ).toBeNull();
    expect(
      trainingGateError({ requiredTrainingIds: ['r1'], facts: [fact('Dave', 'r1', 'in_date')] }),
    ).toBeNull();
    expect(
      trainingGateError({ requiredTrainingIds: ['r1'], facts: [fact('Dave', 'r1', 'expired')] }),
    ).toBe('training-expired');
    expect(
      trainingGateError({ requiredTrainingIds: ['r1'], facts: [fact('Nia', 'r1', 'not_held')] }),
    ).toBe('training-missing');
  });

  it('PW-E12: requirements the type does not demand are ignored', () => {
    expect(
      trainingGateError({
        requiredTrainingIds: ['r1'],
        facts: [fact('Dave', 'r1', 'in_date'), fact('Dave', 'r2', 'expired')],
      }),
    ).toBeNull();
  });

  it('PW-E12: every shortfall is listed so the UI can name names', () => {
    const shortfalls = trainingGateShortfalls({
      requiredTrainingIds: ['r1', 'r2'],
      facts: [
        fact('Dave', 'r1', 'expired'),
        fact('Dave', 'r2', 'in_date'),
        fact('Nia', 'r1', 'not_held'),
        fact('Nia', 'r2', 'expiring_soon'),
      ],
    });
    expect(shortfalls).toHaveLength(2);
    expect(shortfalls.map((s) => `${s.personLabel}:${s.reason}`)).toEqual([
      'Dave:training-expired',
      'Nia:training-missing',
    ]);
    // Expired outranks missing in the single-verdict headline.
    expect(
      trainingGateError({
        requiredTrainingIds: ['r1', 'r2'],
        facts: [fact('Nia', 'r1', 'not_held'), fact('Dave', 'r2', 'expired')],
      }),
    ).toBe('training-expired');
  });
});
