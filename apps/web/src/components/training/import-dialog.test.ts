/**
 * Web-path tests for the training module (FreeHS B7).
 *
 * The review named the root cause of four consecutive modules' defects:
 * *"no test touches a web path"* — every defect it found lived in one.
 * These pin the parts of the web surface that carry real logic rather
 * than layout, so a regression fails here instead of in production.
 *
 * Edge cases:
 *   - TR-W10: the CSV reader accepts what an LMS export actually looks
 *     like — quoted commas, a BOM, CRLF, trailing blank lines
 *   - TR-W11: a header missing a required column is refused as a header
 *     problem, not silently imported as zero rows
 *   - TR-W12: optional columns are omitted rather than sent as empty
 *     strings, so the server's defaults apply
 */
import { describe, expect, it } from 'vitest';
import { parseCsv } from './import-dialog';

describe('training CSV import (web path)', () => {
  it('TR-W10: reads a realistic export — quotes, BOM, CRLF, blank tail', () => {
    const csv =
      '﻿personName,userEmail,requirementName,achievedAt,expiresAt\r\n' +
      '"Mullins, Dave",dave@x.test,Abrasive wheels,2026-01-05,2029-01-05\r\n' +
      'Sarah Yeung,sarah@x.test,First aid at work,2026-02-01,\r\n' +
      '\r\n';
    const { rows, error } = parseCsv(csv);
    expect(error).toBeNull();
    expect(rows).toHaveLength(2);
    // The BOM must not become part of the first column name, or every
    // row silently loses its personName.
    expect(rows[0]?.personName).toBe('Mullins, Dave');
    expect(rows[0]?.expiresAt).toBe('2029-01-05');
    // An empty optional cell is omitted, not sent as ''.
    expect(rows[1]?.expiresAt).toBeUndefined();
  });

  it('TR-W11: a header missing a required column is a header error', () => {
    // Refusing this as "no rows" would send the user hunting through
    // 2,000 lines for a problem that is on line 1.
    const { rows, error } = parseCsv('personName,achievedAt\nDave,2026-01-05\n');
    expect(error).toBe('columns');
    expect(rows).toHaveLength(0);
  });

  it('TR-W11: an empty file, or a header with no rows, reports empty', () => {
    expect(parseCsv('').error).toBe('empty');
    expect(parseCsv('personName,requirementName,achievedAt\n').error).toBe('empty');
  });

  it('TR-W12: rows missing a required VALUE are skipped, not half-imported', () => {
    const csv =
      'personName,requirementName,achievedAt\n' +
      'Dave,Abrasive wheels,2026-01-05\n' +
      ',Abrasive wheels,2026-01-05\n' +
      'Nia,,2026-01-05\n';
    const { rows } = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.personName).toBe('Dave');
  });

  it('TR-W12: escaped double quotes survive', () => {
    const csv =
      'personName,requirementName,achievedAt\n' + '"O""Brien, Sean",Manual handling,2026-03-01\n';
    const { rows } = parseCsv(csv);
    expect(rows[0]?.personName).toBe('O"Brien, Sean');
  });

  it('TR-W12: column order does not matter, only the header names', () => {
    const csv =
      'achievedAt,requirementName,personName,certificateNumber\n' +
      '2026-04-02,CSCS card,Alan Pike,CS-9911\n';
    const { rows } = parseCsv(csv);
    expect(rows[0]).toMatchObject({
      personName: 'Alan Pike',
      requirementName: 'CSCS card',
      achievedAt: '2026-04-02',
      certificateNumber: 'CS-9911',
    });
  });
});
