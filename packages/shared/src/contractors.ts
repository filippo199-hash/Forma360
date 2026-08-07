/**
 * Contractors domain logic (FreeHS) — the pure rules the gate and the
 * visit board depend on.
 *
 * This module exists because the same two decisions were being made in
 * three places and drifted apart:
 *
 *   - **Who may come through the gate.** `gate.selfCheckIn` (the kiosk)
 *     and `visits.checkIn` (the desk) each had their own copy of the
 *     refusal, and each refused only `non_compliant`. A contractor
 *     *suspended* by an administrator walked straight through — and
 *     because a manual override REPLACES the derived status, suspending
 *     a contractor whose insurance had lapsed converted a refusal into an
 *     admission. The control built to bar someone from site was the one
 *     that admitted them.
 *
 *   - **Which visit transitions are legal.** Check-in, check-out and
 *     delete each guarded one condition and none guarded status, so a
 *     visit could be deleted out from under someone standing on site,
 *     checked out twice with the departure time moving each time, or
 *     checked in again while still carrying a past departure.
 *
 * Both are now single, tested functions. The typing is deliberately
 * honest: the previous code cast the override to a type that did not
 * include `'suspended'`, which is exactly why the missing case compiled.
 */

// ─── Compliance ─────────────────────────────────────────────────────────────

/** What the document evidence alone says about a contractor. */
export const DERIVED_COMPLIANCE_STATUSES = [
  'compliant',
  'non_compliant',
  'no_requirements',
] as const;
export type DerivedComplianceStatus = (typeof DERIVED_COMPLIANCE_STATUSES)[number];

/** What an administrator can assert manually, overriding the evidence. */
export const COMPLIANCE_OVERRIDES = ['compliant', 'non_compliant', 'suspended'] as const;
export type ComplianceOverride = (typeof COMPLIANCE_OVERRIDES)[number];

/**
 * The status anything downstream should act on.
 *
 * The union genuinely includes `'suspended'`. The old code declared this
 * as the derived type and cast the override into it, so `'suspended'`
 * existed at runtime and was invisible to the compiler — which is how a
 * `=== 'non_compliant'` check passed review.
 */
export type EffectiveComplianceStatus = DerivedComplianceStatus | 'suspended';

/** An override, where present, wins over the evidence. */
export function effectiveComplianceStatus(args: {
  override: ComplianceOverride | null;
  derived: DerivedComplianceStatus;
}): EffectiveComplianceStatus {
  return args.override ?? args.derived;
}

/**
 * Does this status bar someone from site?
 *
 * `no_requirements` does not: a contractor nobody has asked for paperwork
 * from is not thereby unsafe, and blocking them would make the register
 * unusable on day one. `suspended` and `non_compliant` both bar — the
 * first is a deliberate human decision and is, if anything, the stronger
 * signal of the two.
 */
export function complianceBarsEntry(status: EffectiveComplianceStatus): boolean {
  return status === 'non_compliant' || status === 'suspended';
}

/**
 * Whether a staff override may waive this refusal at the desk.
 *
 * Missing paperwork is a judgement call a supervisor is allowed to make
 * with a recorded reason. A **suspension is not**: it is an explicit
 * decision by someone with authority that this contractor does not come
 * on site, and a desk override that could undo it would make the control
 * decorative.
 */
export function complianceOverridable(status: EffectiveComplianceStatus): boolean {
  return status === 'non_compliant';
}

// ─── Visit lifecycle ────────────────────────────────────────────────────────

export const VISIT_STATUSES = [
  'scheduled',
  'checked_in',
  'checked_out',
  'cancelled',
  'no_show',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const VISIT_TRANSITIONS = ['check_in', 'check_out', 'cancel', 'delete'] as const;
export type VisitTransition = (typeof VISIT_TRANSITIONS)[number];

/** Refusal slugs. Each maps to a translated message in the web layer. */
export type VisitTransitionError =
  | 'visit-cancelled'
  | 'visit-already-checked-in'
  | 'visit-not-checked-in'
  | 'visit-already-checked-out'
  | 'visit-on-site';

/** Is someone currently on site under this visit? */
export function visitIsOnSite(status: VisitStatus): boolean {
  return status === 'checked_in';
}

/**
 * The legal-transition table, in one place.
 *
 * Returns the refusal slug, or null when the transition is allowed.
 *
 * The rules, and why:
 *   - a cancelled visit accepts nothing; it is not a visit any more;
 *   - **check-in is not repeatable.** The kiosk used to accept a second
 *     scan, which re-stamped `checkedInAt` — and since the overstay
 *     worker measures from that stamp, a contractor could clear their own
 *     overstay alert simply by scanning again;
 *   - **check-out is not repeatable** either. Guarding only "was never
 *     checked in" let a second tap move `checkedOutAt` forward and
 *     overwrite the real departure time, which is the one fact the record
 *     exists to preserve;
 *   - **a visit with someone on site cannot be deleted.** The on-site
 *     board is what a fire marshal reads at the assembly point; archiving
 *     a checked-in visit erased a person who is physically present, with
 *     no check-out event and no record they ever left. Check them out
 *     first, then delete.
 */
export function visitTransitionError(args: {
  status: VisitStatus;
  transition: VisitTransition;
}): VisitTransitionError | null {
  const { status, transition } = args;

  if (status === 'cancelled' && transition !== 'delete') return 'visit-cancelled';

  switch (transition) {
    case 'check_in':
      if (status === 'checked_in') return 'visit-already-checked-in';
      return null;
    case 'check_out':
      if (status === 'checked_out') return 'visit-already-checked-out';
      if (status !== 'checked_in') return 'visit-not-checked-in';
      return null;
    case 'cancel':
      // Cancelling someone who is on site would leave them on the board
      // with no departure, exactly like deleting them.
      if (visitIsOnSite(status)) return 'visit-on-site';
      return null;
    case 'delete':
      if (visitIsOnSite(status)) return 'visit-on-site';
      return null;
  }
}

// ─── Document period of cover ───────────────────────────────────────────────

/**
 * `contractor_documents.end_date === null` is read downstream as "never
 * expires" — by `requirementSatisfied`, which is what the gate consults
 * before admitting a visit, and (inverted) by the expiry-reminder worker,
 * which filters on `endDate IS NOT NULL`.
 *
 * That reading is only defensible when a human deliberately said so. The
 * contractor portal collected no expiry at all, so **every** self-service
 * upload landed in that bucket: a document that satisfies a blocking
 * requirement forever, opens the gate forever, and is excluded from the
 * only mechanism that would ever revisit it. Silent and terminal.
 *
 * The fix is not to reinterpret null — "never expires" is a real state for
 * a company registration or a lifetime qualification, and flipping the
 * predicate would turn every existing contractor non-compliant overnight
 * with no operator warning. The fix is to make null unreachable **by
 * omission**: every write boundary demands a date or an explicit
 * assertion, and fails closed when it gets neither.
 */
export type DocumentPeriodError =
  | 'INVALID_START_DATE'
  | 'INVALID_END_DATE'
  | 'INVALID_PERIOD'
  | 'EXPIRY_REQUIRED'
  | 'EXPIRY_IN_PAST';

export interface DocumentPeriodInput {
  /** `''` means "not supplied". */
  startDate: string;
  /** `''` means "not supplied". */
  endDate: string;
  /** The uploader explicitly asserted this document never expires. */
  noExpiry: boolean;
  /**
   * From the requirement. A company that put the evidence on a renewal
   * cycle has already said it expires, so a perpetual document cannot
   * logically satisfy it — there is no escape hatch here.
   */
  recurrenceMonths: number | null;
  /** Today as `YYYY-MM-DD`. Injected so this stays pure and testable. */
  today: string;
  /**
   * Refuse an expiry date that has already passed. True on the contractor's
   * own portal, where accepting one hands them a "done ✓" for work that
   * still has to happen. **False at the staff desk**, where recording the
   * certificate that lapsed last week — while the replacement is chased —
   * is a legitimate audit trail, and where an expired document plainly
   * fails to satisfy its requirement anyway.
   */
  rejectExpired: boolean;
}

export type DocumentPeriodResult = { ok: true } | { ok: false; error: DocumentPeriodError };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a real calendar day.
 *
 * The old check was the regex alone, which accepts `2026-13-45` — that
 * reached the `date` column and Postgres raised, so a typo became a 500
 * instead of a 400.
 */
export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Today as `YYYY-MM-DD` (UTC) — the shape a `date` column stores. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function validateDocumentPeriod(input: DocumentPeriodInput): DocumentPeriodResult {
  if (input.startDate !== '' && !isCalendarDate(input.startDate)) {
    return { ok: false, error: 'INVALID_START_DATE' };
  }
  if (input.endDate !== '' && !isCalendarDate(input.endDate)) {
    return { ok: false, error: 'INVALID_END_DATE' };
  }
  if (input.endDate === '') {
    if (input.recurrenceMonths !== null) return { ok: false, error: 'EXPIRY_REQUIRED' };
    if (!input.noExpiry) return { ok: false, error: 'EXPIRY_REQUIRED' };
    return { ok: true };
  }
  if (input.startDate !== '' && input.endDate < input.startDate) {
    return { ok: false, error: 'INVALID_PERIOD' };
  }
  if (input.rejectExpired && input.endDate < input.today) {
    return { ok: false, error: 'EXPIRY_IN_PAST' };
  }
  return { ok: true };
}

// ─── Gate capture fields ────────────────────────────────────────────────────

/**
 * The first required gate question left unanswered, or null.
 *
 * The kiosk enforced this and the desk did not, so a staff-recorded
 * arrival produced an event indistinguishable from one where the
 * induction question had actually been asked. Both paths now run this.
 */
export function firstMissingGateField(
  fields: ReadonlyArray<{ id: string; label: string; required: boolean }>,
  /** `capturedFields` as the API carries it: fieldId → answer. */
  answers: Readonly<Record<string, string>>,
): { id: string; label: string } | null {
  for (const field of fields) {
    if (!field.required) continue;
    if ((answers[field.id] ?? '').trim().length === 0) {
      return { id: field.id, label: field.label };
    }
  }
  return null;
}
