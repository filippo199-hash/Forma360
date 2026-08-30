/**
 * FR-01..FR-06 — the Focus ranking is deterministic and honours the
 * user's taught rules without ever letting a demote outrank a missed
 * statutory clock by accident (a demote subtracts a fixed step; overdue
 * adds a bigger one, so an overdue-but-demoted item still beats an idle
 * undated one).
 */
import { describe, expect, it } from 'vitest';
import { primaryReason, rankFocus, type FocusRow, type FocusRule } from './focus-ranking';

const NOW = new Date('2026-08-16T09:00:00.000Z');

function row(over: Partial<FocusRow> & { id: string }): FocusRow {
  return {
    kind: 'action',
    title: `Item ${over.id}`,
    href: `/x/${over.id}`,
    dueAt: null,
    overdue: false,
    ...over,
  };
}

const rule = (over: Partial<FocusRule> & { id: string }): FocusRule => ({
  ruleType: 'kind',
  value: 'action',
  direction: 'boost',
  note: '',
  ...over,
});

describe('rankFocus', () => {
  it('FR-01: overdue beats due-soon beats undated, regardless of kind base', () => {
    const ranked = rankFocus(
      [
        row({ id: 'undated', kind: 'approval' }),
        row({ id: 'soon', dueAt: new Date('2026-08-19T09:00:00.000Z') }),
        row({ id: 'late', dueAt: new Date('2026-08-10T09:00:00.000Z'), overdue: true }),
      ],
      [],
      NOW,
    );
    expect(ranked.map((r) => r.row.id)).toEqual(['late', 'soon', 'undated']);
  });

  it('FR-02: more days late ranks higher, capped at 30', () => {
    const ranked = rankFocus(
      [
        row({ id: 'week', dueAt: new Date('2026-08-09T09:00:00.000Z'), overdue: true }),
        row({ id: 'quarter', dueAt: new Date('2026-05-01T09:00:00.000Z'), overdue: true }),
        row({ id: 'year', dueAt: new Date('2025-08-01T09:00:00.000Z'), overdue: true }),
      ],
      [],
      NOW,
    );
    expect(ranked[0]?.row.id).not.toBe('week');
    // The cap makes quarter and year equal on score — dueAt asc breaks
    // the tie, so the OLDEST deadline leads.
    expect(ranked.map((r) => r.row.id)).toEqual(['year', 'quarter', 'week']);
  });

  it('FR-03: a kind boost lifts matching rows above non-matching peers', () => {
    const ranked = rankFocus(
      [row({ id: 'a', kind: 'action' }), row({ id: 't', kind: 'training' })],
      [rule({ id: 'r1', ruleType: 'kind', value: 'training', note: 'certs first' })],
      NOW,
    );
    expect(ranked[0]?.row.id).toBe('t');
    expect(primaryReason(ranked[0]?.reasons ?? [])).toEqual({
      kind: 'boosted',
      note: 'certs first',
    });
  });

  it('FR-04: a keyword demote sinks matching rows (case-insensitive)', () => {
    const ranked = rankFocus(
      [
        row({ id: 'noise', title: 'Weekly NOISE survey' }),
        row({ id: 'real', title: 'Fix guard rail' }),
      ],
      [rule({ id: 'r1', ruleType: 'keyword', value: 'noise', direction: 'demote' })],
      NOW,
    );
    expect(ranked.map((r) => r.row.id)).toEqual(['real', 'noise']);
  });

  it('FR-05: a demoted overdue item still beats an idle undated one', () => {
    const ranked = rankFocus(
      [
        row({ id: 'idle' }),
        row({
          id: 'lateDemoted',
          dueAt: new Date('2026-08-01T09:00:00.000Z'),
          overdue: true,
        }),
      ],
      [rule({ id: 'r1', ruleType: 'keyword', value: 'latedemoted', direction: 'demote' })],
      NOW,
    );
    expect(ranked[0]?.row.id).toBe('lateDemoted');
  });

  it('FR-06: identical inputs produce identical order (title tiebreak)', () => {
    const rows = [row({ id: 'b', title: 'Bravo' }), row({ id: 'a', title: 'Alpha' })];
    const first = rankFocus(rows, [], NOW).map((r) => r.row.id);
    const second = rankFocus([...rows].reverse(), [], NOW).map((r) => r.row.id);
    expect(first).toEqual(['a', 'b']);
    expect(second).toEqual(first);
  });
});
