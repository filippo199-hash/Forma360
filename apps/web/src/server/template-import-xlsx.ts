/**
 * Pure file-shaping helpers for the import path. Kept free of `env` / Anthropic
 * imports so the SheetJS parsing seam is unit-testable without API credentials.
 */
import * as XLSX from 'xlsx';

/** Cap on spreadsheet text fed to the model (keeps the prompt bounded). */
export const MAX_SHEET_CHARS = 120_000;

export function isExcelLike(filename: string, mimeType: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls') ||
    lower.endsWith('.csv') ||
    mimeType.includes('spreadsheet') ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'text/csv'
  );
}

export function isPdf(filename: string, mimeType: string): boolean {
  return filename.toLowerCase().endsWith('.pdf') || mimeType === 'application/pdf';
}

/** Flatten every sheet of a workbook to labelled CSV text the model can read. */
export function workbookToText(bytes: Uint8Array): string {
  const wb = XLSX.read(bytes, { type: 'array' });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (sheet === undefined) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim().length === 0) continue;
    parts.push(`### Sheet: ${name}\n${csv}`);
  }
  return parts.join('\n\n').slice(0, MAX_SHEET_CHARS);
}
