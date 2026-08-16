/**
 * What is safe to show after an activity-log line.
 *
 * Activity rows carry a free-text `detail` that the router writes for its own
 * convenience — sometimes a human phrase ("Nitrile gloves and goggles"),
 * sometimes a ULID (`surveillance_enrolled` stores the enrolled user's id),
 * sometimes a bare enum or a JSON blob. The COSHH substance page appended it
 * verbatim, so an HSE evaluation found audit entries reading
 *
 *     Enrolled — 01KZH2DSEHDT8H08K0DXPGXB03
 *
 * An audit trail is read by people; an opaque identifier is worse than no
 * suffix at all, because it looks like the system is leaking its internals.
 *
 * `displayableDetail` keeps prose and drops machine values. It is deliberately
 * conservative: when in doubt, show nothing and let the event label stand on
 * its own, which is always readable.
 */

/** ULIDs are 26 chars of Crockford base32; better-auth ids carry a prefix. */
const ID_LIKE = /^(?:[0-9A-HJKMNP-TV-Z]{26}|[a-z]{2,5}_[A-Za-z0-9]{10,})$/;

/** A bare enum token such as `considered_rejected` or `v3`. */
const ENUM_LIKE = /^[a-z][a-z0-9_]*$|^v\d+$/;

/** A bare number ("0", "3", "1.5") — a machine count, never prose. */
const NUMBER_LIKE = /^\d+([.,]\d+)?$/;

export function displayableDetail(detail: string | null | undefined): string | null {
  if (detail === null || detail === undefined) return null;
  const trimmed = detail.trim();
  if (trimmed === '') return null;
  // JSON payloads are for the API, never for a reader.
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return null;
  }
  if (ID_LIKE.test(trimmed)) return null;
  if (NUMBER_LIKE.test(trimmed)) return null;
  // A lone enum token is noise next to a label that already says the same
  // thing; a phrase containing spaces is genuine content.
  if (!trimmed.includes(' ') && ENUM_LIKE.test(trimmed)) return null;
  return trimmed;
}

// ─── COSHH event rendering (BUG-16 / NR3-08) ────────────────────────────────

/**
 * The fields `coshh.assessments.update` may name in an `updated` event —
 * mirrors `UPDATABLE_ASSESSMENT_FIELDS` in the router. The renderer maps
 * each through `coshh.activity.fields.<name>`; anything outside this set is
 * skipped rather than shown raw, so a router field added without a label
 * degrades to the bare kind line instead of leaking a column name.
 */
export const COSHH_UPDATED_FIELD_NAMES = new Set([
  'taskDescription',
  'routesOfExposure',
  'personsExposed',
  'personsCount',
  'quantityBand',
  'frequencyBand',
  'durationBand',
  'levRequired',
  'healthSurveillanceRequired',
  'exposureMonitoringRequired',
  'emergencyNotes',
  'plainSummary',
  'assessorUserId',
  'reviewFrequencyMonths',
  'nextReviewAt',
]);

export type CoshhEventDisplay =
  | { type: 'fields'; fields: string[] }
  | { type: 'publishedVersion'; version: number }
  | { type: 'text'; text: string };

/** `updated` rows: "field, field | was {json}" — CO-R07 evidence format. */
const UPDATED_FIELDS_RE = /^([A-Za-z][A-Za-z0-9]*(?:, [A-Za-z][A-Za-z0-9]*)*) \| was \{/;

/**
 * Kind-aware display for a COSHH activity row (BUG-16). The `coshh_events`
 * rows stay exactly as written — they are append-only evidence — and only
 * the DISPLAY changes:
 *   - `updated` rows carry raw column names plus a before-values JSON blob;
 *     readers get the field list (translated by the caller), never the JSON;
 *   - `published` rows carry `v<n>` (NR3-08); legacy rows hold a bare
 *     actions count, indistinguishable from a number, and are suppressed;
 *   - everything else falls back to the conservative `displayableDetail`.
 */
export function coshhEventDisplay(
  kind: string,
  detail: string | null | undefined,
): CoshhEventDisplay | null {
  const trimmed = detail?.trim() ?? '';
  if (trimmed === '') return null;
  if (kind === 'updated') {
    const match = UPDATED_FIELDS_RE.exec(trimmed);
    if (match !== null && match[1] !== undefined) {
      const fields = match[1].split(', ').filter((f) => COSHH_UPDATED_FIELD_NAMES.has(f));
      return fields.length > 0 ? { type: 'fields', fields } : null;
    }
  }
  if (kind === 'published') {
    const version = /^v(\d+)$/.exec(trimmed);
    if (version !== null && version[1] !== undefined) {
      return { type: 'publishedVersion', version: Number(version[1]) };
    }
    // Legacy rows: the pre-fix actions count. A bare digit is not evidence
    // a reader can use — the kind label stands on its own.
    return null;
  }
  const text = displayableDetail(trimmed);
  return text !== null ? { type: 'text', text } : null;
}
