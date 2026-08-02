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
 */
import { describe, expect, it } from 'vitest';
import {
  allPreconditionsChecked,
  canTransition,
  closureComplete,
  DEFAULT_PERMIT_TYPES,
  isOpenPermitStatus,
  OPEN_PERMIT_STATUSES,
  overlaps,
  PERMIT_CATEGORIES,
  PERMIT_STATUSES,
  permitIsOverdue,
  snapshotPreconditions,
  validityWindowError,
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
    expect(canTransition('issued', 'draft')).toBe(false);
    expect(canTransition('suspended', 'issued')).toBe(false);
    for (const to of PERMIT_STATUSES) {
      expect(canTransition('closed', to)).toBe(false);
      expect(canTransition('cancelled', to)).toBe(false);
    }
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
    expect(byCat.get('confined_space')?.requiresGasTesting).toBe(true);
    expect(byCat.get('hot_work')?.requiresGasTesting).toBe(true);
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
