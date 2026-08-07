/**
 * Asset activity stream — the merge of inspections, actions and
 * observations that replaced three separate tabs.
 *
 * Edge cases:
 *   - AS-AC01: all three sources appear, newest first
 *   - AS-AC02: an inspection is dated by completion, falling back to start
 *   - AS-AC03: an undated row sinks instead of jumping to the top
 *   - AS-AC04: each kind links to its own module
 */
import { describe, expect, it } from 'vitest';
import { buildActivityRows } from './asset-activity';

const base = {
  locale: 'en',
  inspections: [] as never[],
  actions: [] as never[],
  observations: [] as never[],
};

describe('asset activity stream', () => {
  it('AS-AC01: merges all three sources, newest first', () => {
    const rows = buildActivityRows({
      ...base,
      inspections: [
        {
          id: 'i1',
          title: 'Monthly check',
          status: 'completed',
          startedAt: '2026-01-01',
          completedAt: '2026-03-01',
        },
      ],
      actions: [
        { id: 'a1', title: 'Replace guard', status: 'open', dueAt: null, createdAt: '2026-05-01' },
      ],
      observations: [{ id: 'o1', title: 'Oil leak', status: 'open', createdAt: '2026-02-01' }],
    });
    expect(rows.map((r) => r.id)).toEqual(['a1', 'i1', 'o1']);
    expect(rows.map((r) => r.kind)).toEqual(['action', 'inspection', 'observation']);
  });

  it('AS-AC02: an inspection is dated by completion, falling back to start', () => {
    const [completed] = buildActivityRows({
      ...base,
      inspections: [
        {
          id: 'i1',
          title: 'Done',
          status: 'completed',
          startedAt: '2026-01-01',
          completedAt: '2026-06-01',
        },
      ],
    });
    expect(completed?.at?.toISOString().slice(0, 10)).toBe('2026-06-01');

    const [running] = buildActivityRows({
      ...base,
      inspections: [
        {
          id: 'i2',
          title: 'In progress',
          status: 'in_progress',
          startedAt: '2026-01-01',
          completedAt: null,
        },
      ],
    });
    expect(running?.at?.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('AS-AC03: an undated row sinks rather than leading the list', () => {
    // A null timestamp sorts as 0 under a naive numeric compare, which
    // would put the least-known row at the top of "most recent".
    const rows = buildActivityRows({
      ...base,
      actions: [
        { id: 'undated', title: 'No dates', status: 'open', dueAt: null, createdAt: null },
        { id: 'dated', title: 'Dated', status: 'open', dueAt: null, createdAt: '2026-04-01' },
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(['dated', 'undated']);
    expect(rows[1]?.at).toBeNull();
  });

  it('AS-AC04: each kind links into its own module', () => {
    const rows = buildActivityRows({
      ...base,
      locale: 'it',
      inspections: [
        { id: 'i1', title: 'x', status: 'completed', startedAt: null, completedAt: '2026-01-01' },
      ],
      actions: [{ id: 'a1', title: 'y', status: 'open', dueAt: null, createdAt: '2026-01-02' }],
      observations: [{ id: 'o1', title: 'z', status: 'open', createdAt: '2026-01-03' }],
    });
    const href = (id: string) => rows.find((r) => r.id === id)?.href;
    expect(href('i1')).toBe('/it/inspections/i1');
    expect(href('a1')).toBe('/it/actions?action=a1');
    expect(href('o1')).toBe('/it/observations/o1');
  });
});
