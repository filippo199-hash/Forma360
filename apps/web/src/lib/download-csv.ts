/**
 * Client-side CSV download (G3). Registers hand their currently-shown rows
 * as a header row + string cells; this quotes/escapes to RFC-4180 and
 * triggers a browser download. Used by the ResultsFooter's download icon so
 * every table can export "these results" without a server round-trip.
 */
function escapeCell(value: string): string {
  // Quote when the cell contains a comma, quote, or newline; double inner quotes.
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  const lines = [headers, ...rows].map((cells) => cells.map(escapeCell).join(','));
  // Prepend a BOM so Excel reads UTF-8 (accented names, £, etc.) correctly.
  const blob = new Blob(['﻿' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
