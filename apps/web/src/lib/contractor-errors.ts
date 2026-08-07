/**
 * Translate a contractors-router refusal into the reader's language.
 *
 * Every refusal the module can raise arrived in the UI as a raw server
 * string: a Polish user checking someone out of site read the literal
 * English `Visit was never checked in`, and three surfaces showed the
 * snake_case token `contractor_non_compliant` verbatim. The router now
 * throws stable slugs; this is the one place that turns a slug into a
 * sentence.
 *
 * The fallback is deliberate and layered: an unknown slug falls back to
 * the server's own message rather than a generic "something went wrong",
 * because a message we have not mapped yet is still more useful than no
 * message — and an empty one falls back to the module's generic error.
 */

/** Every slug the contractors router raises, and its `contractors.errors.*` key. */
const SLUG_KEYS = {
  // Visit lifecycle — the shared state machine in @forma360/shared/contractors.
  'visit-cancelled': 'visitCancelled',
  'visit-already-checked-in': 'visitAlreadyCheckedIn',
  'visit-not-checked-in': 'visitNotCheckedIn',
  'visit-already-checked-out': 'visitAlreadyCheckedOut',
  'visit-on-site': 'visitOnSite',
  // Gate.
  gate_field_required: 'gateFieldRequired',
  contractor_non_compliant: 'contractorNonCompliant',
  contractor_suspended: 'contractorSuspended',
  // Document period of cover (CT-U01).
  EXPIRY_REQUIRED: 'expiryRequired',
  EXPIRY_IN_PAST: 'expiryInPast',
  INVALID_PERIOD: 'invalidPeriod',
  INVALID_START_DATE: 'invalidStartDate',
  INVALID_END_DATE: 'invalidEndDate',
  'invalid-date': 'invalidDate',
  // Portal users.
  contractor_user_not_found: 'contractorUserNotFound',
  cannot_remove_self: 'cannotRemoveSelf',
  cannot_remove_last_admin: 'cannotRemoveLastAdmin',
  'contractor-user-email-taken': 'contractorUserEmailTaken',
} as const;

export type ContractorErrorSlug = keyof typeof SLUG_KEYS;

export function isContractorErrorSlug(value: string): value is ContractorErrorSlug {
  return Object.prototype.hasOwnProperty.call(SLUG_KEYS, value);
}

/**
 * `t` is the `contractors` namespace translator. Returns a sentence for a
 * known slug, the server's own message for an unknown one, and the
 * module's generic error when there is nothing at all to show.
 */
export function contractorErrorMessage(message: string, t: (key: string) => string): string {
  const trimmed = message.trim();
  if (isContractorErrorSlug(trimmed)) return t(`errors.${SLUG_KEYS[trimmed]}`);
  // A Zod validation failure arrives as a multi-line JSON array of issues.
  // Showing that to a user is worse than saying nothing specific.
  if (trimmed.startsWith('[') || trimmed === '') return t('error');
  return trimmed;
}
