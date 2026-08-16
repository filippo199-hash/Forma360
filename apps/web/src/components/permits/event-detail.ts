/**
 * BUG-14 straggler: the `extended` timeline event's detail string is
 * written by the router as raw UTC ISO timestamps
 * ("2026-08-16T15:00:00.000Z -> 2026-08-16T19:00:00.000Z") and both the
 * permit page and the print layout render event detail verbatim — one row
 * of machine-format UTC below a timeline column that is correctly
 * site-local. Reformatting at render time (rather than at write time)
 * keeps the stored detail machine-readable, needs no document-timezone
 * lookup in the router, and fixes every historical event retroactively.
 *
 * The match is strict full-ISO-with-Z only, so free-text notes that merely
 * mention a date are never touched.
 */
const ISO_UTC_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z/g;

export function formatIsoDatesInText(text: string, format: (iso: string) => string): string {
  return text.replace(ISO_UTC_RE, (match) => format(match));
}
