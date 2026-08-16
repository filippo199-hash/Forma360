/**
 * BUG-14 straggler: extension events bake UTC ISO timestamps into their
 * detail string; render surfaces must reformat them into the document
 * timezone instead of printing "2026-08-16T15:00:00.000Z" one row under a
 * correctly site-local timeline.
 */
import { formatInTimeZone } from '@forma360/shared/timezone';
import { describe, expect, it } from 'vitest';
import { formatIsoDatesInText } from './event-detail';

/** The print layout's formatter, pinned to a BST date so UTC ≠ local. */
function at(iso: string): string {
  return formatInTimeZone(new Date(iso), 'Europe/London', 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
}

describe('formatIsoDatesInText (BUG-14)', () => {
  it('reformats every full ISO-with-Z timestamp through the document clock', () => {
    const detail =
      '2026-08-16T15:00:00.000Z -> 2026-08-16T19:00:00.000Z (acknowledged 1 simultaneous-operation conflict(s))';
    const out = formatIsoDatesInText(detail, at);
    // No machine-format UTC survives…
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/);
    // …and the times are site-local (BST = UTC+1 on 16 Aug).
    expect(out).toContain('16:00');
    expect(out).toContain('20:00');
    expect(out).toContain('(acknowledged 1 simultaneous-operation conflict(s))');
  });

  it('leaves free-text notes that merely mention dates untouched', () => {
    const note = 'Meet at bay 4 on 2026-08-16, badge 12:30Z applies';
    expect(formatIsoDatesInText(note, at)).toBe(note);
  });

  it('handles second-precision ISO strings without millis', () => {
    const out = formatIsoDatesInText('2026-01-10T09:00:00Z', at);
    expect(out).not.toContain('Z');
    expect(out).toContain('09:00');
  });
});
