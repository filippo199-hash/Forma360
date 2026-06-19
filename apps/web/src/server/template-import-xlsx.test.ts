import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { isExcelLike, isPdf, workbookToText } from './template-import-xlsx';

/** Build an .xlsx file in memory from a 2-D array of rows. */
function xlsxBytes(sheets: Record<string, (string | number)[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

describe('file-type detection', () => {
  it('recognises Excel by extension and mime', () => {
    expect(isExcelLike('checklist.xlsx', '')).toBe(true);
    expect(isExcelLike('old.xls', '')).toBe(true);
    expect(isExcelLike('data.csv', '')).toBe(true);
    expect(isExcelLike('x', 'application/vnd.ms-excel')).toBe(true);
    expect(isExcelLike('form.pdf', 'application/pdf')).toBe(false);
  });

  it('recognises PDF by extension and mime', () => {
    expect(isPdf('form.pdf', '')).toBe(true);
    expect(isPdf('x', 'application/pdf')).toBe(true);
    expect(isPdf('sheet.xlsx', '')).toBe(false);
  });
});

describe('workbookToText', () => {
  it('flattens each sheet to labelled CSV', () => {
    const bytes = xlsxBytes({
      Checks: [
        ['Item', 'Result'],
        ['Tyres', 'Pass'],
        ['Brakes', 'Fail'],
      ],
      Notes: [['Comment'], ['Looks good']],
    });
    const text = workbookToText(bytes);
    expect(text).toContain('### Sheet: Checks');
    expect(text).toContain('Item,Result');
    expect(text).toContain('Tyres,Pass');
    expect(text).toContain('Brakes,Fail');
    expect(text).toContain('### Sheet: Notes');
    expect(text).toContain('Looks good');
  });

  it('skips empty sheets', () => {
    const bytes = xlsxBytes({ Empty: [], Data: [['A'], ['1']] });
    const text = workbookToText(bytes);
    expect(text).not.toContain('### Sheet: Empty');
    expect(text).toContain('### Sheet: Data');
  });
});
