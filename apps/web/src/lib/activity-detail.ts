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
  // A lone enum token is noise next to a label that already says the same
  // thing; a phrase containing spaces is genuine content.
  if (!trimmed.includes(' ') && ENUM_LIKE.test(trimmed)) return null;
  return trimmed;
}
