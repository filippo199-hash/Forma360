/**
 * The one place a generated file reaches the user's disk (BUG-21).
 *
 * Two things converged here, and they had the same defect independently:
 * every module hand-rolled its own blob download, and the G3 register work
 * added a `downloadCsv(filename, headers, rows)` helper for the
 * ResultsFooter. Both of them, and every copy before them, did this:
 *
 *   1. `URL.revokeObjectURL(url)` on the line after `a.click()`. The click
 *      starts the download asynchronously, so revoking the blob URL
 *      synchronously can abort it before it begins — which is exactly what
 *      HSE testers reported: "no visible file, nothing in the network log".
 *      The anchor was also never attached to the document, which some
 *      browsers require.
 *   2. Nothing said anything. A silent success and a silent failure look
 *      identical, so three practitioners could not tell whether export
 *      worked at all, and none could judge output they never received.
 *
 * So there is one delivery path — attach, click, revoke on the next
 * macrotask, name the file that landed — and both call shapes sit on top of
 * it. `downloadCsv` keeps the ResultsFooter's row-building signature;
 * `downloadCsvFile` takes CSV a caller has already built.
 */
import { toast } from 'sonner';

/** Long enough for the browser to have started the transfer. */
const REVOKE_DELAY_MS = 2_000;

export interface DownloadOptions {
  /** Shown on success — pass the translated "Downloaded {file}" string. */
  successMessage?: string;
}

/**
 * Hand `content` to the browser as `filename`.
 *
 * Throws nothing: callers that need to report a failure should catch around
 * the fetch that produced the content, which is where failures happen.
 */
export function downloadFile(
  content: BlobPart,
  filename: string,
  mimeType: string,
  options: DownloadOptions = {},
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  // Some browsers ignore a click on a detached anchor.
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Do NOT revoke synchronously — see the note above.
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, REVOKE_DELAY_MS);
  if (options.successMessage !== undefined) toast.success(options.successMessage);
}

/** CSV convenience wrapper for callers that already hold the text. */
export function downloadCsvFile(
  csv: string,
  filename: string,
  options: DownloadOptions = {},
): void {
  downloadFile(csv, filename, 'text/csv;charset=utf-8;', options);
}

/** Quote when the cell contains a comma, quote, or newline (RFC 4180). */
function escapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Build a CSV from a header row + string cells and hand it over (G3).
 *
 * The ResultsFooter's download icon calls this so every table can export
 * "these results" without a server round-trip.
 */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: string[][],
  options: DownloadOptions = {},
): void {
  const lines = [headers, ...rows].map((cells) => cells.map(escapeCell).join(','));
  // Prepend a BOM so Excel reads UTF-8 (accented names, £, …) correctly.
  downloadCsvFile(
    '﻿' + lines.join('\r\n'),
    filename.endsWith('.csv') ? filename : `${filename}.csv`,
    options,
  );
}

/** `YYYY-MM-DD`, for stamping an export filename. */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
