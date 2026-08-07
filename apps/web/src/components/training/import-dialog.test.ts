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
import { groupErrors, parseCsv } from './import-dialog';

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
  it('TR-B4: rows missing a required value are REPORTED, not silently dropped', () => {
    // The defect this test exists for: a 2,000-row extract with 40 missing
    // dates imported 1,960 and reported "Imported 1,960" with no failures.
    // Silent truncation on an import is the worst failure mode there is.
    const csv =
      'personName,requirementName,achievedAt\n' +
      'Dave,Abrasive wheels,2026-01-05\n' +
      ',Abrasive wheels,2026-01-05\n' +
      'Nia,,2026-01-05\n' +
      'Tom,Manual handling,\n';
    const { rows, skipped } = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(skipped).toHaveLength(3);
    expect(skipped.map((s) => s.message)).toEqual([
      'missing:personName',
      'missing:requirementName',
      'missing:achievedAt',
    ]);
  });

  it('TR-B4: reported row numbers are the user’s file lines, not array indices', () => {
    // Once anything is dropped, an index into the surviving array is offset
    // from the spreadsheet the user is being asked to go and fix.
    const csv =
      'personName,requirementName,achievedAt\n' + // line 1
      ',Abrasive wheels,2026-01-05\n' + // line 2 — bad
      '\n' + // line 3 — blank, must not shift the count
      'Dave,Abrasive wheels,2026-01-05\n'; // line 4 — good
    const { rows, skipped } = parseCsv(csv);
    expect(skipped[0]?.row).toBe(2);
    expect(rows[0]?.sourceRow).toBe(4);
  });

  it('TR-B4: a file of nothing but bad rows is a failure report, not "empty"', () => {
    const { rows, skipped, error } = parseCsv('personName,requirementName,achievedAt\n,,\n,,\n');
    expect(rows).toHaveLength(0);
    expect(skipped).toHaveLength(2);
    // Not 'empty' — there IS something to tell the user about.
    expect(error).toBeNull();
  });

  it('groups repeated identical failures so one bad course name is one line', () => {
    // An extract with one unknown course produced one error PER ROW — up to
    // 2,000 identical lines in a small scroll box.
    const grouped = groupErrors([
      { row: 2, message: 'unknown-requirement:Fork Lift' },
      { row: 5, message: 'unknown-requirement:Fork Lift' },
      { row: 9, message: 'unknown-requirement:Fork Lift' },
      { row: 3, message: 'invalid-date:32/13/2026' },
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({ message: 'unknown-requirement:Fork Lift', count: 3 });
    expect(grouped[0]?.rows).toEqual([2, 5, 9]);
    expect(grouped[1]).toMatchObject({ count: 1 });
  });
});
