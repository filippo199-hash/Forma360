/**
 * The one place a generated file reaches the user's disk (BUG-21).
 *
 * Every module hand-rolled this, and every copy had the same two faults:
 *
 *   1. `URL.revokeObjectURL(url)` fired on the line after `a.click()`. The
 *      click starts the download asynchronously, so revoking the blob URL
 *      synchronously can abort it before it begins — which is exactly what
 *      testers saw: "no visible file, nothing in the network log". The
 *      anchor was also never in the document, which some browsers require.
 *   2. Nothing said anything. A silent success and a silent failure look
 *      identical, so three practitioners could not tell whether export
 *      worked at all, and none of them could judge the output because they
 *      never found a file.
 *
 * So: attach the anchor, click it, revoke on the next macrotask, and tell
 * the user the filename that just landed. A download the user cannot find
 * is not a delivered export.
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
 * the fetch that produced the content, which is where failures actually
 * happen.
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

/** CSV convenience wrapper — the common case by a wide margin. */
export function downloadCsvFile(
  csv: string,
  filename: string,
  options: DownloadOptions = {},
): void {
  downloadFile(csv, filename, 'text/csv;charset=utf-8;', options);
}

/** `YYYY-MM-DD`, for stamping an export filename. */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
