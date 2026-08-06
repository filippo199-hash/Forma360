/**
 * Training & competence matrix (FreeHS module B7) — the pure domain logic.
 *
 * The panel's one-line brief: *a register of who holds what, against a
 * definition of who needs what — with the gap made visible, chased,
 * exportable and enforceable.* Explicitly **not** an LMS: no courses, no
 * enrolment, no content. If a feature answers "how do I train someone"
 * it is out of scope; if it answers "who has done what, and what's
 * missing", it is in.
 *
 * Three objects, and the matrix is a *derived view* over the last two —
 * never a stored table, exactly as fire safety, permits and COSHH
 * compute their statuses rather than storing them:
 *   1. requirement          — the training type + its validity period
 *   2. requirement assignment — who needs it (role / group / site / person)
 *   3. record               — what someone actually holds
 *
 * The status vocabulary is lifted from `marshalTrainingStatus` in
 * `fire-safety.ts` (the review names it as the reference implementation)
 * and generalised with `not_required`, so fire safety can consume this
 * back rather than keeping a second copy.
 *
 * Records are **append-only**: a renewal inserts a new row and never
 * overwrites an old expiry. That is what lets `statusAsOf` answer the
 * auditor's real question — *was this person competent **on the day**?*
 */

// ─── Status vocabulary ──────────────────────────────────────────────────────

/**
 * Every state a (person, requirement) pair can be in.
 *
 * `not_held` is "required but never recorded"; `not_required` is "not in
 * this person's set at all". Keeping them apart is what makes a gap list
 * possible — one is a gap, the other is a blank.
 */
export const TRAINING_STATUSES = [
  'in_date',
  'expiring_soon',
  'expired',
  'not_held',
  'not_required',
] as const;

export type TrainingStatus = (typeof TRAINING_STATUSES)[number];

/**
 * The glyph shown for each status. Status is **never** encoded in colour
 * alone (Bello): at 120,000 cells a colour-blind reviewer with no glyphs
 * has no matrix at all. Every renderer pairs glyph + colour + text label.
 */
export const TRAINING_STATUS_GLYPH: Record<TrainingStatus, string> = {
  in_date: '●',
  expiring_soon: '⚠',
  expired: '⛔',
  not_held: '○',
  not_required: '–',
};

/** Statuses that represent a gap the gap list must surface, worst first. */
export const GAP_STATUSES: readonly TrainingStatus[] = ['expired', 'expiring_soon', 'not_held'];

/** Sort weight — worst first, so a gap list orders itself. */
const STATUS_RANK: Record<TrainingStatus, number> = {
  expired: 0,
  expiring_soon: 1,
  not_held: 2,
  in_date: 3,
  not_required: 4,
};

export function compareTrainingStatus(a: TrainingStatus, b: TrainingStatus): number {
  return STATUS_RANK[a] - STATUS_RANK[b];
}

/** Does this status keep someone off a permit / out of a gated activity? */
export function isBlockingStatus(status: TrainingStatus): boolean {
  return status === 'expired' || status === 'not_held';
}

// ─── Requirement defaults ───────────────────────────────────────────────────

/**
 * Default renewal lead time. A requirement may override it — a CSCS card
 * needs chasing months out, a toolbox talk does not.
 */
export const DEFAULT_RENEWAL_LEAD_DAYS = 60;

/** Requirement categories. `statutory` and `mandatory` report separately (Bello). */
export const TRAINING_OBLIGATIONS = ['statutory', 'mandatory', 'discretionary'] as const;
export type TrainingObligation = (typeof TRAINING_OBLIGATIONS)[number];

/** How a record came to be — it carries different evidential weight (Lindqvist). */
export const TRAINING_RECORD_SOURCES = [
  'internal',
  'external',
  'imported',
  'self_declared',
] as const;
export type TrainingRecordSource = (typeof TRAINING_RECORD_SOURCES)[number];

/** Verification state, mirroring `contractor_documents` (the shape Lindqvist asked for). */
export const TRAINING_VERIFICATION_STATUSES = ['unverified', 'verified', 'rejected'] as const;
export type TrainingVerificationStatus = (typeof TRAINING_VERIFICATION_STATUSES)[number];

/** How a requirement reaches a person. A person's set is the union of all four. */
export const TRAINING_ASSIGNMENT_SCOPES = ['role', 'group', 'site', 'person'] as const;
export type TrainingAssignmentScope = (typeof TRAINING_ASSIGNMENT_SCOPES)[number];

// ─── Expiry computation ─────────────────────────────────────────────────────

/**
 * Expiry for a record achieved on `achievedAt` under a requirement with a
 * `validityMonths` period. `null` validity = a qualification that does not
 * expire, which yields a `null` expiry (and therefore a permanent
 * `in_date`).
 *
 * Month arithmetic clamps rather than overflowing: 31 Jan + 1 month is
 * 28/29 Feb, not 2/3 March, because a certificate dated the 31st must not
 * silently gain days.
 */
export function computeExpiry(achievedAt: Date, validityMonths: number | null): Date | null {
  if (validityMonths === null || validityMonths <= 0) return null;
  const d = new Date(achievedAt.getTime());
  const targetMonth = d.getUTCMonth() + validityMonths;
  const day = d.getUTCDate();
  const candidate = new Date(
    Date.UTC(
      d.getUTCFullYear(),
      targetMonth,
      1,
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
  // Last day of the target month, so a day-31 source date clamps down.
  const lastDay = new Date(
    Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0),
  ).getUTCDate();
  candidate.setUTCDate(Math.min(day, lastDay));
  return candidate;
}

// ─── Status computation ─────────────────────────────────────────────────────

/** The slice of a record this module needs to decide a status. */
export interface TrainingRecordLike {
  readonly achievedAt: Date;
  readonly expiresAt: Date | null;
}

/**
 * Status of one (person, requirement) pair.
 *
 * Generalises `marshalTrainingStatus`: no record at all is `not_held`
 * rather than `not_trained`, and a caller that knows the requirement does
 * not apply passes `required: false` to get `not_required`. A record with
 * no expiry is permanently in date (a non-expiring qualification).
 */
export function trainingStatus(args: {
  required: boolean;
  record: TrainingRecordLike | null;
  leadDays?: number;
  now: Date;
}): TrainingStatus {
  const { required, record, now } = args;
  if (record === null) return required ? 'not_held' : 'not_required';
  // A held record still shows its real state even when no longer required
  // — the wallet must not blank a card just because a role changed.
  if (record.expiresAt === null) return 'in_date';
  if (record.expiresAt.getTime() <= now.getTime()) return 'expired';
  const leadDays = args.leadDays ?? DEFAULT_RENEWAL_LEAD_DAYS;
  if (record.expiresAt.getTime() - now.getTime() <= leadDays * 86_400_000) {
    return 'expiring_soon';
  }
  return 'in_date';
}

/**
 * The record that governs a (person, requirement) pair **as at** a date.
 *
 * Records are append-only, so "current" is not "the newest row" — it is
 * the one achieved on or before `asOf` with the furthest-reaching cover.
 * Picking by `achievedAt` alone would let a backdated entry override a
 * later renewal; picking by expiry alone would let a lapsed-but-longer
 * record beat a fresh short one. Prefer the latest expiry, and break ties
 * on the later achievement date.
 *
 * Passing a past `asOf` answers the post-incident question — *was this
 * operator competent on the day?* — which a today-only matrix cannot.
 */
export function currentRecord<T extends TrainingRecordLike>(
  records: readonly T[],
  asOf: Date,
): T | null {
  const eligible = records.filter((r) => r.achievedAt.getTime() <= asOf.getTime());
  if (eligible.length === 0) return null;
  return eligible.reduce((best, r) => {
    // A never-expiring record outranks any dated one.
    if (r.expiresAt === null) return best.expiresAt === null ? laterAchieved(best, r) : r;
    if (best.expiresAt === null) return best;
    if (r.expiresAt.getTime() > best.expiresAt.getTime()) return r;
    if (r.expiresAt.getTime() < best.expiresAt.getTime()) return best;
    return laterAchieved(best, r);
  });
}

function laterAchieved<T extends TrainingRecordLike>(a: T, b: T): T {
  return b.achievedAt.getTime() > a.achievedAt.getTime() ? b : a;
}

/**
 * Status of a (person, requirement) pair as at a date, from that person's
 * full record history. The one call the matrix, gap list, wallet and the
 * permit gate all go through, so they can never disagree.
 */
export function statusAsOf(args: {
  required: boolean;
  records: readonly TrainingRecordLike[];
  leadDays?: number;
  asOf: Date;
}): TrainingStatus {
  const record = currentRecord(args.records, args.asOf);
  return trainingStatus({
    required: args.required,
    record,
    ...(args.leadDays !== undefined ? { leadDays: args.leadDays } : {}),
    now: args.asOf,
  });
}

// ─── Compliance roll-up ─────────────────────────────────────────────────────

/**
 * Compliance percentage over a set of computed statuses.
 *
 * `not_required` is excluded from both numerator and denominator — a
 * person who was never required to hold a thing must not dilute the
 * figure in either direction. `expiring_soon` counts as compliant: it is
 * still valid today, which is what "compliant as at" means.
 *
 * Returns `null` for an empty denominator rather than 0% or 100%, so a
 * ward with no requirements reads "—" instead of a lie in either
 * direction.
 */
export function compliancePercent(statuses: readonly TrainingStatus[]): number | null {
  const applicable = statuses.filter((s) => s !== 'not_required');
  if (applicable.length === 0) return null;
  const compliant = applicable.filter((s) => s === 'in_date' || s === 'expiring_soon').length;
  return Math.round((compliant / applicable.length) * 100);
}
