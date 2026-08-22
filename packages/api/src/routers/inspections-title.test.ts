/**
 * UXW4-02 — the inspection title tokens, tested directly.
 *
 * `{date}` used to render ISO, and because `titleFormat` defaults to
 * `{date}` the inspection's own NAME read "2026-08-22" everywhere it
 * appeared: page heading, register row, approvals queue, printed report.
 * The pure function is pinned so the format cannot drift back without a
 * red test.
 *
 * **This lives in its own file on purpose.** Adding
 * `import { renderTitle } from './inspections'` to `inspections.test.ts`
 * evaluated that module BEFORE `../router`, which inverted the dependents
 * registration order the root router relies on: `templates.ts` registers
 * a zero-returning shim and `inspections.ts` overwrites it with the real
 * count, so running inspections first meant the shim won and the
 * template-dependents test read 0 instead of 2. The failure surfaced in a
 * test that had nothing to do with the change — exactly the kind of
 * landmine an import-order convention leaves behind. A separate file has
 * its own module graph and cannot reorder anything.
 */
import { describe, expect, it } from 'vitest';
import { renderTitle } from './inspections';

describe('renderTitle (UXW4-02)', () => {
  const date = new Date('2026-08-22T09:15:00.000Z');

  it('renders {date} in the house format, not ISO', () => {
    expect(renderTitle('{date}', { date })).toBe('22 Aug 2026');
  });

  it('keeps the other tokens and the surrounding literal text', () => {
    expect(
      renderTitle('{date} AUDIT {docNumber} — {site} by {conductedBy}', {
        date,
        site: 'Northfield Works',
        conductedBy: 'Steve Barnes',
        documentNumber: 'AUDIT000004',
      }),
    ).toBe('22 Aug 2026 AUDIT AUDIT000004 — Northfield Works by Steve Barnes');
  });

  it('pins a single-digit day without a leading zero', () => {
    // en-GB with day:'numeric' — "9 Aug 2026", never "09/08/2026", which
    // is the ambiguity format-date.ts exists to keep off UK records.
    expect(renderTitle('{date}', { date: new Date('2026-08-09T12:00:00.000Z') })).toBe(
      '9 Aug 2026',
    );
  });
});
