/**
 * Permit-to-work domain helpers (FreeHS module B3).
 *
 * Pure data + functions shared by the DB schema, the API router, the web
 * UI and the expiry-watch worker:
 *   - the permit category vocabulary and the seeded default permit types
 *     (hot work, confined space, work at height, electrical, excavation,
 *     roof work, asbestos, lifting, pressure systems) with their
 *     precondition checklists and signature requirements;
 *   - the lifecycle state machine (`canTransition`) — the router refuses
 *     any move not in this matrix;
 *   - validity-window arithmetic: overlap detection for simultaneous-
 *     operations (SIMOPs) conflict warnings, overdue detection for the
 *     live board and the expiry escalation worker, and the window
 *     validator (inverted / over-cap windows refused);
 *   - Zod schemas for every jsonb payload the permit row persists
 *     (precondition snapshot, gas readings, attachments, closure checks)
 *     — ground rule 2, Zod at every boundary.
 *
 * Everything here is deterministic and side-effect free so the tRPC
 * layer, client components and the worker can all import it.
 *
 * Seeded catalogue content (type names, precondition labels) is tenant
 * DATA, seeded in English and fully editable — the same stance as the
 * risk-matrix defaults and COSHH substance records. UI chrome (statuses,
 * buttons, column headers) is translated via `permits.*` message keys.
 */
import { z } from 'zod';

import type { RamsReviewOutcome } from './rams';

// ─── Categories ─────────────────────────────────────────────────────────────

/**
 * The nine statutory-ish high-risk activity families the module ships
 * with, plus 'other' for tenant-defined custom types. The category drives
 * the icon and grouping only — behaviour lives on the permit type row.
 */
export const PERMIT_CATEGORIES = [
  'hot_work',
  'confined_space',
  'work_at_height',
  'electrical',
  'excavation',
  'roof_work',
  'asbestos',
  'lifting',
  'pressure_systems',
  'other',
] as const;
export type PermitCategory = (typeof PERMIT_CATEGORIES)[number];

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export const PERMIT_STATUSES = [
  'draft',
  'issued',
  'active',
  'suspended',
  'closed',
  'cancelled',
] as const;
export type PermitStatus = (typeof PERMIT_STATUSES)[number];

/** Statuses that appear on the live board and count as "work may be happening". */
export const OPEN_PERMIT_STATUSES = ['issued', 'active', 'suspended'] as const;

export function isOpenPermitStatus(status: PermitStatus): boolean {
  return (OPEN_PERMIT_STATUSES as readonly string[]).includes(status);
}

/**
 * The lifecycle state machine. `active → issued` is the shift-handover
 * drop: the incoming acceptor must sign on before work continues.
 * `issued → closed` covers the permit that was worked without the digital
 * acceptance ever being recorded — the practitioner still closes it out
 * formally rather than "cancelling" work that happened.
 */
const PERMIT_TRANSITIONS: Record<PermitStatus, ReadonlyArray<PermitStatus>> = {
  draft: ['issued', 'cancelled'],
  // `issued → draft` is REFUSAL: the named acceptor sends the permit
  // back to the issuer for correction. Without it the acceptor's only
  // options were to sign, or to cancel — and cancelling KILLS the
  // permit rather than bouncing it. Faced with a hot-work permit
  // carrying a contradiction on its face, "the only honest action
  // available to me is to destroy the record". Refusing and cancelling
  // are different acts and a permit system needs both.
  issued: ['active', 'draft', 'closed', 'cancelled'],
  active: ['suspended', 'issued', 'closed', 'cancelled'],
  suspended: ['active', 'closed', 'cancelled'],
  closed: [],
  cancelled: [],
};

export function canTransition(from: PermitStatus, to: PermitStatus): boolean {
  return PERMIT_TRANSITIONS[from].includes(to);
}

// ─── Validity-window arithmetic ─────────────────────────────────────────────

/**
 * Strict interval overlap: two windows that merely touch (one ends the
 * instant the other starts) do NOT overlap — back-to-back permits in the
 * same area are the normal shift pattern, not a SIMOPs conflict.
 */
export function overlaps(aFrom: Date, aTo: Date, bFrom: Date, bTo: Date): boolean {
  return aFrom.getTime() < bTo.getTime() && bFrom.getTime() < aTo.getTime();
}

/**
 * A permit is overdue when it is in an open status past its validity end
 * — the "someone may still be in there" state the expiry watch escalates.
 */
export function permitIsOverdue(
  permit: { status: PermitStatus; validTo: Date },
  now: Date,
): boolean {
  return isOpenPermitStatus(permit.status) && permit.validTo.getTime() < now.getTime();
}

export type ValidityWindowError = 'window-invalid' | 'window-too-long';

/**
 * Validate a validity window against the permit type's duration cap.
 * Returns null when the window is acceptable.
 */
export function validityWindowError(
  validFrom: Date,
  validTo: Date,
  maxDurationHours: number,
): ValidityWindowError | null {
  if (validTo.getTime() <= validFrom.getTime()) return 'window-invalid';
  const hours = (validTo.getTime() - validFrom.getTime()) / 3_600_000;
  if (hours > maxDurationHours) return 'window-too-long';
  return null;
}

// ─── Preconditions ──────────────────────────────────────────────────────────

/** A checklist item as defined on the permit type. */
export const permitTypePreconditionSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(300),
});
export type PermitTypePrecondition = z.infer<typeof permitTypePreconditionSchema>;

/**
 * A checklist item as snapshotted onto a permit at creation, with its
 * confirmation state. Timestamps are ISO strings — this shape lives in a
 * jsonb column.
 */
export const permitPreconditionStateSchema = permitTypePreconditionSchema.extend({
  checked: z.boolean(),
  checkedBy: z.string().nullable(),
  checkedByName: z.string().nullable(),
  checkedAt: z.string().nullable(),
  note: z.string().max(500),
});
export type PermitPreconditionState = z.infer<typeof permitPreconditionStateSchema>;

/** Copy the type's checklist onto a new permit, all unchecked. */
export function snapshotPreconditions(
  defs: ReadonlyArray<PermitTypePrecondition>,
): PermitPreconditionState[] {
  return defs.map((d) => ({
    id: d.id,
    label: d.label,
    checked: false,
    checkedBy: null,
    checkedByName: null,
    checkedAt: null,
    note: '',
  }));
}

export function allPreconditionsChecked(
  states: ReadonlyArray<Pick<PermitPreconditionState, 'checked'>>,
): boolean {
  return states.every((s) => s.checked);
}

// ─── Gas readings ───────────────────────────────────────────────────────────

export const GAS_READING_UNITS = ['percent_lel', 'percent_o2', 'ppm', 'mg_m3'] as const;
export type GasReadingUnit = (typeof GAS_READING_UNITS)[number];

/**
 * Physically possible ranges per unit (NR-03). Both percent units are
 * % v/v, so a value above 100 cannot exist in nature; ppm caps at one
 * million by definition; mg/m³ gets the same sane ceiling. Oxygen is
 * deliberately 0–100 and NOT 0–25: an enrichment reading (say 40 % near a
 * leaking O₂ lance) is exactly the dangerous evidence the router insists
 * on RECORDING — the bound refuses impossible numbers, never bad news.
 */
export const GAS_READING_BOUNDS: Readonly<Record<GasReadingUnit, { min: number; max: number }>> = {
  percent_lel: { min: 0, max: 100 },
  percent_o2: { min: 0, max: 100 },
  ppm: { min: 0, max: 1_000_000 },
  mg_m3: { min: 0, max: 1_000_000 },
};

/** Inclusive physical-bounds check for one value in one unit (NR-03). */
export function isGasReadingValueInBounds(unit: GasReadingUnit, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const bounds = GAS_READING_BOUNDS[unit];
  return value >= bounds.min && value <= bounds.max;
}

/**
 * An acceptable range for one measured gas, configured on the permit type
 * (HSE review PW-1). `min`/`max` are inclusive bounds; null = unbounded on
 * that side. A reading recorded against the limit snapshots its verdict.
 * NR-03: a configured limit must itself sit inside the unit's physical
 * bounds — "max 9999 % LEL" is a typo, not a policy.
 */
/**
 * The stored shape WITHOUT the NR-03 bounds refinement. Update paths that
 * resend a type's FULL limits array parse against this and bounds-check
 * only new-or-modified entries via {@link gasLimitBoundsError} — a legacy
 * out-of-bounds limit saved before the bounds existed must not brick every
 * other edit to its type's limits.
 */
export const gasLimitBaseSchema = z.object({
  id: z.string().min(1).max(40),
  /** What is measured — "Oxygen (O₂)", "Flammables (LEL)". Tenant data. */
  label: z.string().trim().min(1).max(120),
  unit: z.enum(GAS_READING_UNITS),
  min: z.number().finite().nullable(),
  max: z.number().finite().nullable(),
});

/**
 * The stable guard key a limit violates, or null when it is sound.
 * Shared by the schema refinement and the update path's targeted check.
 */
export function gasLimitBoundsError(limit: {
  unit: GasReadingUnit;
  min: number | null;
  max: number | null;
}): 'gas-limit-out-of-bounds' | 'gas-limit-min-above-max' | null {
  if (limit.min !== null && !isGasReadingValueInBounds(limit.unit, limit.min)) {
    return 'gas-limit-out-of-bounds';
  }
  if (limit.max !== null && !isGasReadingValueInBounds(limit.unit, limit.max)) {
    return 'gas-limit-out-of-bounds';
  }
  if (limit.min !== null && limit.max !== null && limit.min > limit.max) {
    return 'gas-limit-min-above-max';
  }
  return null;
}

export const gasLimitSchema = gasLimitBaseSchema.superRefine((limit, ctx) => {
  if (limit.min !== null && !isGasReadingValueInBounds(limit.unit, limit.min)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['min'],
      message: 'gas-limit-out-of-bounds',
    });
  }
  if (limit.max !== null && !isGasReadingValueInBounds(limit.unit, limit.max)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['max'],
      message: 'gas-limit-out-of-bounds',
    });
  }
  if (limit.min !== null && limit.max !== null && limit.min > limit.max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['min'],
      message: 'gas-limit-min-above-max',
    });
  }
});
export type GasLimit = z.infer<typeof gasLimitSchema>;

/**
 * One atmosphere-test result recorded on the permit (jsonb entry).
 * `limitId` + `withinLimits` were added by the PW-1 hardening — readings
 * recorded before it (or free readings on types without limits) carry
 * neither, so both are optional and treated as "not evaluated".
 */
export const gasReadingSchema = z
  .object({
    id: z.string().min(1).max(40),
    substance: z.string().min(1).max(120),
    reading: z.number().finite(),
    unit: z.enum(GAS_READING_UNITS),
    takenAt: z.string().min(1),
    takenBy: z.string().min(1),
    takenByName: z.string().max(200),
    note: z.string().max(500),
    /** The type gas-limit this reading was recorded against, if any. */
    limitId: z.string().min(1).max(40).nullable().optional(),
    /** Verdict against the limit, snapshotted at record time. */
    withinLimits: z.boolean().nullable().optional(),
  })
  // NR-03: −5 % LEL and 9999 % LEL are instrument-impossible; refuse them
  // at the boundary rather than filing them as atmosphere evidence.
  .superRefine((r, ctx) => {
    if (!isGasReadingValueInBounds(r.unit, r.reading)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reading'],
        message: 'gas-reading-out-of-bounds',
      });
    }
  });
export type GasReading = z.infer<typeof gasReadingSchema>;

/** Inclusive range check for one reading against one limit. */
export function readingWithinLimit(
  reading: Pick<GasReading, 'reading' | 'unit'>,
  limit: GasLimit,
): boolean {
  if (reading.unit !== limit.unit) return false;
  if (limit.min !== null && reading.reading < limit.min) return false;
  if (limit.max !== null && reading.reading > limit.max) return false;
  return true;
}

/** Default freshness window for a gas test at the point of issue/resume. */
export const DEFAULT_GAS_TEST_MAX_AGE_MINUTES = 60;

export type GasGateError = 'gas-test-required' | 'gas-test-out-of-range' | 'gas-test-stale';

/**
 * The PW-1 gas gate, shared by issue and resume. With limits configured,
 * EVERY limit needs a reading recorded against it, the LATEST reading per
 * limit must be in-range, and it must be fresh (within `maxAgeMinutes` of
 * `now`). Without limits (custom types), presence + freshness of the
 * latest reading is required. `takenAfter` restricts which readings count
 * — resume passes the suspension time so only a re-test satisfies it.
 *
 * Precedence is deterministic: missing before out-of-range before stale.
 */
export function gasGateError(args: {
  requiresGasTesting: boolean;
  limits: ReadonlyArray<GasLimit>;
  maxAgeMinutes: number;
  readings: ReadonlyArray<GasReading>;
  now: Date;
  takenAfter?: Date | undefined;
}): GasGateError | null {
  if (!args.requiresGasTesting) return null;
  const cutoff = args.takenAfter?.getTime();
  const usable = args.readings.filter((r) => {
    const t = Date.parse(r.takenAt);
    return Number.isFinite(t) && (cutoff === undefined || t > cutoff);
  });
  const freshEnough = (r: GasReading): boolean =>
    args.now.getTime() - Date.parse(r.takenAt) <= args.maxAgeMinutes * 60_000;
  const latestOf = (list: ReadonlyArray<GasReading>): GasReading | undefined =>
    [...list].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt)).at(-1);

  if (args.limits.length === 0) {
    const latest = latestOf(usable);
    if (latest === undefined) return 'gas-test-required';
    return freshEnough(latest) ? null : 'gas-test-stale';
  }

  const latestPerLimit = args.limits.map((limit) => ({
    limit,
    latest: latestOf(usable.filter((r) => r.limitId === limit.id)),
  }));
  if (latestPerLimit.some((e) => e.latest === undefined)) return 'gas-test-required';
  if (
    latestPerLimit.some((e) => e.latest !== undefined && !readingWithinLimit(e.latest, e.limit))
  ) {
    return 'gas-test-out-of-range';
  }
  if (latestPerLimit.some((e) => e.latest !== undefined && !freshEnough(e.latest))) {
    return 'gas-test-stale';
  }
  return null;
}

// ─── The RAMS gate (RS-E14 / RS-A11) ───────────────────────────────────────

export type RamsGateError =
  | 'rams-pack-required'
  | 'rams-pack-not-issued'
  | 'rams-acceptance-expired';

/**
 * What the permit's RAMS link currently resolves to, as loaded from the
 * database. `null` means the permit links to nothing (or links to a row
 * that no longer exists).
 */
export type PermitRamsLink =
  | {
      kind: 'own_pack';
      /** Status of the pack owning the linked version. */
      packStatus: string;
    }
  | {
      kind: 'third_party_review';
      outcome: RamsReviewOutcome;
      validFrom: Date | null;
      validTo: Date | null;
    }
  | null;

/**
 * The RS-E14 RAMS gate. A permit whose type demands an accepted safe system
 * of work may be backed by either side of the module:
 *   - an OWN pack: the linked pack version must belong to a pack that is
 *     currently `issued` (a withdrawn or superseded pack stops backing it);
 *   - a THIRD-PARTY pack: the linked review must be accepted (with or
 *     without conditions) and still inside its validity window.
 *
 * RS-A11: this is pure so the permit page can preview the blocker before
 * the issuer presses Issue, standing at the job. The router loads the link
 * facts; both sides then reach the same verdict from the same code.
 *
 * Returns null when the gate is satisfied.
 */
export function ramsGateError(args: {
  requiresRamsPack: boolean;
  link: PermitRamsLink;
  now: Date;
}): RamsGateError | null {
  if (!args.requiresRamsPack) return null;
  if (args.link === null) return 'rams-pack-required';
  if (args.link.kind === 'own_pack') {
    return args.link.packStatus === 'issued' ? null : 'rams-pack-not-issued';
  }
  const { outcome, validFrom, validTo } = args.link;
  if (outcome !== 'accepted' && outcome !== 'accepted_with_conditions') {
    return 'rams-acceptance-expired';
  }
  if (validFrom !== null && validFrom.getTime() > args.now.getTime())
    return 'rams-acceptance-expired';
  if (validTo !== null && validTo.getTime() < args.now.getTime()) return 'rams-acceptance-expired';
  return null;
}

// ─── Risk-assessment gate (RA-X03) ─────────────────────────────────────────

export type RiskAssessmentGateError =
  | 'risk-assessment-required'
  | 'risk-assessment-not-signed-off'
  | 'risk-assessment-withdrawn';

/**
 * Is the risk assessment cited on this permit actually in force?
 *
 * RA-X03: the permit gate enforced `requiresRiskAssessment` as PRESENCE —
 * `riskAssessmentId === null` — and never looked at status, so a permit to
 * work could be issued citing an assessment that was still a **draft**, or
 * one that had been **withdrawn**. The permit prints the RA reference
 * beside its own number as though it were in force.
 *
 * A permit to work is the document that says the work has been assessed
 * and controlled; issued against an unsigned assessment, its central
 * assertion is unverified. And the status was already in hand —
 * `loadRiskAssessmentInTenant` in the permits router has always SELECTed
 * `status`, for a check nobody wrote.
 *
 * Pure, and shaped exactly like {@link ramsGateError} (RS-A11) so the
 * permit page can preview the blocker before the issuer presses Issue,
 * standing at the job. That asymmetry — RAMS gated properly ten lines
 * below, RA gated on a null — is what made this a gap rather than a
 * policy.
 *
 * Returns null when the gate is satisfied.
 */
export function riskAssessmentGateError(args: {
  requiresRiskAssessment: boolean;
  /** Null when no assessment is cited at all. */
  assessment: { status: 'draft' | 'active' | 'archived' } | null;
}): RiskAssessmentGateError | null {
  if (!args.requiresRiskAssessment) return null;
  if (args.assessment === null) return 'risk-assessment-required';
  switch (args.assessment.status) {
    case 'active':
      return null;
    case 'draft':
      return 'risk-assessment-not-signed-off';
    case 'archived':
      return 'risk-assessment-withdrawn';
  }
}

// ─── Competence gate (FreeHS B7 — the training matrix hook) ─────────────────

export type TrainingGateError =
  | 'training-missing'
  | 'training-expired'
  /**
   * PW-X03: the person is named on the permit but not linked to a user
   * account, so no record can be attributed to them with certainty.
   */
  | 'training-unverifiable-identity';

/** One person's standing against one required requirement, as loaded. */
export interface TrainingGateFact {
  readonly personLabel: string;
  readonly requirementId: string;
  readonly requirementName: string;
  /** Computed by `trainingStatus` in `training.ts` — the single source. */
  readonly status: 'in_date' | 'expiring_soon' | 'expired' | 'not_held' | 'not_required';
  /**
   * PW-X03: whether this person is a linked user account rather than a
   * free-text name. REQUIRED, deliberately — the defect was that an
   * unlinked person was matched to a training record by
   * `personName.toLowerCase()`, so an untrained "john smith" passed the
   * gate on a ticket belonging to a *different* John Smith and appeared
   * in no shortfall list. Making the caller state this is what stops the
   * next one silently reintroducing the namesake match.
   */
  readonly linked: boolean;
}

/** Who is short of what, for the UI to name names rather than say "blocked". */
export interface TrainingGateShortfall {
  readonly personLabel: string;
  readonly requirementId: string;
  readonly requirementName: string;
  readonly reason: TrainingGateError;
}

/**
 * The competence gate. Until this existed, nine seeded permit types asked
 * the issuer to tick "competence of all operatives verified" — an
 * attestation of something the platform could already check, and the
 * weakest control in the product. This replaces the tick with a real
 * check against the training matrix for every named operative.
 *
 * `expiring_soon` does **not** block: the card is valid today, and a
 * permit that runs for a shift does not fail because a ticket lapses next
 * month. Only `expired` and `not_held` stop an issue.
 *
 * Pure, and returns *every* shortfall rather than the first, so the permit
 * page can list exactly who to swap out before the issuer presses Issue
 * (the RS-A11 lesson: a gate the UI cannot preview is a gate people learn
 * to route around).
 */
export function trainingGateShortfalls(args: {
  requiredTrainingIds: readonly string[];
  facts: readonly TrainingGateFact[];
}): TrainingGateShortfall[] {
  if (args.requiredTrainingIds.length === 0) return [];
  const required = new Set(args.requiredTrainingIds);
  const shortfalls: TrainingGateShortfall[] = [];
  for (const fact of args.facts) {
    if (!required.has(fact.requirementId)) continue;
    // PW-X03. Where the type demands training, competence must be
    // attributable to a *person*, not to a string. A free-text name can
    // only ever be matched to a record by name, and two people called
    // John Smith are one person as far as that match is concerned — so
    // the gate would print a verdict it had not earned. Unlinked people
    // are refused here rather than name-matched, which keeps the training
    // module's unlinked records available everywhere they are not
    // load-bearing. One shortfall per person per requirement, and no
    // status-based reason on top: the identity is the blocker.
    if (!fact.linked) {
      shortfalls.push({ ...pick(fact), reason: 'training-unverifiable-identity' });
      continue;
    }
    // `not_required` cannot occur for a requirement the permit type
    // demands — the type's demand IS the requirement — so treat it as
    // "no record", which is what it means here.
    if (fact.status === 'expired') {
      shortfalls.push({ ...pick(fact), reason: 'training-expired' });
    } else if (fact.status === 'not_held' || fact.status === 'not_required') {
      shortfalls.push({ ...pick(fact), reason: 'training-missing' });
    }
  }
  return shortfalls;
}

function pick(f: TrainingGateFact) {
  return {
    personLabel: f.personLabel,
    requirementId: f.requirementId,
    requirementName: f.requirementName,
  };
}

/** The blocking verdict: null when every named operative is covered. */
export function trainingGateError(args: {
  requiredTrainingIds: readonly string[];
  facts: readonly TrainingGateFact[];
}): TrainingGateError | null {
  return trainingGateHeadline(trainingGateShortfalls(args));
}

/**
 * Reduce a shortfall list to the single verdict shown at the job face.
 *
 * Exported because `permits.issue` needs exactly this and used to inline
 * its own copy of the precedence — which drifted the moment PW-X03 added
 * a third reason: the page previewed "identity unverifiable" while issue
 * threw "training-missing" for the same permit. RS-A11 says a preview
 * that disagrees with the gate is worse than no preview, so there is now
 * one function and no second copy to forget.
 */
export function trainingGateHeadline(
  shortfalls: readonly TrainingGateShortfall[],
): TrainingGateError | null {
  if (shortfalls.length === 0) return null;
  // PW-X03 outranks both: "we cannot tell who this is" is a different and
  // more fundamental complaint than "their ticket lapsed", and the issuer
  // fixes it differently — by linking an account, not by booking a course.
  if (shortfalls.some((s) => s.reason === 'training-unverifiable-identity')) {
    return 'training-unverifiable-identity';
  }
  // Expired outranks missing in the headline: it is the more alarming
  // finding (someone *was* competent and the system let it lapse).
  return shortfalls.some((s) => s.reason === 'training-expired')
    ? 'training-expired'
    : 'training-missing';
}

// ─── Workers on the permit + entry/exit log (PW-8) ─────────────────────────

export const PERMIT_WORKER_ROLES = ['supervisor', 'worker', 'entrant', 'standby'] as const;
export type PermitWorkerRole = (typeof PERMIT_WORKER_ROLES)[number];

/** One person covered by the permit — the gang, not just the acceptor. */
export const permitWorkerSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  /** Linked platform user, when the person has an account. */
  userId: z.string().max(64).nullable(),
  role: z.enum(PERMIT_WORKER_ROLES),
});
export type PermitWorker = z.infer<typeof permitWorkerSchema>;

export const MAX_WORKERS_PER_PERMIT = 50;
export const MAX_ENTRY_LOG_ROWS = 500;

/**
 * One entry/exit movement — "who is in the space right now" is every row
 * with a null `exitedAt`. Timestamps are ISO strings (jsonb).
 */
export const permitEntryLogRowSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  userId: z.string().max(64).nullable(),
  enteredAt: z.string().min(1),
  exitedAt: z.string().min(1).nullable(),
  loggedBy: z.string().min(1),
});
export type PermitEntryLogRow = z.infer<typeof permitEntryLogRowSchema>;

/** People currently inside under this permit (open entry-log rows). */
export function openEntryCount(log: ReadonlyArray<Pick<PermitEntryLogRow, 'exitedAt'>>): number {
  return log.filter((row) => row.exitedAt === null).length;
}

// ─── Same-area matching (PW-14) ─────────────────────────────────────────────

/**
 * Token-set comparison for the loudest SIMOPs signal. "Bay 4, tank farm"
 * and "Tank farm bay 4" are the same place; so are "bay 4" within
 * "tank farm bay 4" (one side a subset of the other). Empty text never
 * matches — no location is not the same location.
 */
export function sameAreaMatch(a: string, b: string): boolean {
  const tokens = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0),
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const token of small) {
    if (!large.has(token)) return false;
  }
  return true;
}

/** Minutes before expiry at which the worker warns the permit parties (PW-10). */
export const EXPIRY_WARNING_LEAD_MINUTES = 60;

// ─── Attachments ────────────────────────────────────────────────────────────

/** What a permit-record attachment evidences. */
export const PERMIT_ATTACHMENT_KINDS = [
  'isolation_certificate',
  'rescue_plan',
  'gas_test',
  'other',
] as const;
export type PermitAttachmentKind = (typeof PERMIT_ATTACHMENT_KINDS)[number];

export const permitAttachmentSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(PERMIT_ATTACHMENT_KINDS),
  storageKey: z.string().min(1).max(500),
  filename: z.string().min(1).max(300),
  uploadedBy: z.string().min(1),
  uploadedAt: z.string().min(1),
});
export type PermitAttachment = z.infer<typeof permitAttachmentSchema>;

// ─── Closure ────────────────────────────────────────────────────────────────

/**
 * The close-out confirmation set. All four must be true to close — an
 * unclosed permit means someone may still be in there.
 */
export const closureChecksSchema = z.object({
  workComplete: z.boolean(),
  areaMadeSafe: z.boolean(),
  isolationsRemoved: z.boolean(),
  personnelClear: z.boolean(),
});
export type ClosureChecks = z.infer<typeof closureChecksSchema>;

export const CLOSURE_CHECK_KEYS = [
  'workComplete',
  'areaMadeSafe',
  'isolationsRemoved',
  'personnelClear',
] as const satisfies ReadonlyArray<keyof ClosureChecks>;

export function closureComplete(checks: ClosureChecks): boolean {
  return CLOSURE_CHECK_KEYS.every((k) => checks[k]);
}

// ─── Default permit-type catalogue ──────────────────────────────────────────

export interface DefaultPermitType {
  readonly category: Exclude<PermitCategory, 'other'>;
  readonly name: string;
  readonly requiresAuthoriser: boolean;
  readonly requiresGasTesting: boolean;
  readonly requiresIsolationCertificate: boolean;
  readonly requiresRescuePlan: boolean;
  readonly maxDurationHours: number;
  readonly preconditions: ReadonlyArray<PermitTypePrecondition>;
  /** Acceptable ranges the gas gate evaluates (PW-1). Empty = presence-only. */
  readonly gasLimits: ReadonlyArray<GasLimit>;
  /** Freshness window for a gas test at issue/resume, minutes. */
  readonly gasTestMaxAgeMinutes: number;
}

/**
 * UK-practice default acceptable ranges (HSE review PW-1). O₂ 19.5–23.5 %,
 * flammables below 10 % LEL, CO below 30 ppm (EH40 8-hour WEL). Tenant
 * data once seeded — editable per type.
 */
export const DEFAULT_GAS_LIMITS: Readonly<
  Partial<Record<Exclude<PermitCategory, 'other'>, ReadonlyArray<GasLimit>>>
> = {
  hot_work: [
    { id: 'flammables_lel', label: 'Flammables (LEL)', unit: 'percent_lel', min: null, max: 10 },
  ],
  confined_space: [
    { id: 'oxygen', label: 'Oxygen (O₂)', unit: 'percent_o2', min: 19.5, max: 23.5 },
    { id: 'flammables_lel', label: 'Flammables (LEL)', unit: 'percent_lel', min: null, max: 10 },
    { id: 'carbon_monoxide', label: 'Carbon monoxide (CO)', unit: 'ppm', min: null, max: 30 },
  ],
  excavation: [
    { id: 'oxygen', label: 'Oxygen (O₂)', unit: 'percent_o2', min: 19.5, max: 23.5 },
    { id: 'flammables_lel', label: 'Flammables (LEL)', unit: 'percent_lel', min: null, max: 10 },
  ],
};

/**
 * The nine permit types every new tenant starts with. Seeded once per
 * tenant (idempotent) and editable thereafter — these are sensible UK
 * practice defaults, not statutory text. Gas limits and freshness are
 * grafted from `DEFAULT_GAS_LIMITS` below (confined space gets the
 * tighter 30-minute freshness window).
 */
const DEFAULT_PERMIT_TYPE_BASES: ReadonlyArray<
  Omit<DefaultPermitType, 'gasLimits' | 'gasTestMaxAgeMinutes'>
> = [
  {
    category: 'hot_work',
    name: 'Hot work',
    // Hot work is the permit every insurer expects to carry a named
    // authorisation, and it was the one default shipping without one —
    // an issued hot-work permit had an issuer and an acceptor and nobody
    // who authorised the ignition source.
    requiresAuthoriser: true,
    requiresGasTesting: true,
    requiresIsolationCertificate: false,
    requiresRescuePlan: false,
    maxDurationHours: 12,
    preconditions: [
      {
        id: 'combustibles_cleared',
        label: 'Combustible materials removed or protected within 10 m',
      },
      { id: 'extinguisher_at_point', label: 'Suitable fire extinguisher at the point of work' },
      { id: 'fire_watch', label: 'Fire watch arranged during work and for 60 minutes after' },
      { id: 'atmosphere_tested', label: 'Flammable-atmosphere test completed where required' },
      { id: 'containment', label: 'Spark / flame containment (screens, blankets) in place' },
      // Sprinklers and detection are the hot-work precondition most
      // often missed and most often expensive: heat from a weld sets off
      // the head above it, and the usual "fix" — isolating the system
      // for the shift — is exactly the decision that must not be taken
      // informally at the point of work.
      {
        id: 'detection_suppression',
        label:
          'Sprinkler heads and detectors within range protected from heat; any isolation authorised in writing and reinstated at closure',
      },
      { id: 'competence_verified', label: 'Competence of all operatives verified' },
    ],
  },
  {
    category: 'confined_space',
    name: 'Confined space entry',
    requiresAuthoriser: true,
    requiresGasTesting: true,
    requiresIsolationCertificate: true,
    requiresRescuePlan: true,
    maxDurationHours: 8,
    preconditions: [
      { id: 'atmosphere_tested', label: 'Atmosphere tested and within acceptable limits' },
      { id: 'ventilation', label: 'Ventilation established and maintained' },
      { id: 'isolations_proved', label: 'All mechanical / process isolations proved' },
      { id: 'rescue_standby', label: 'Rescue arrangements and trained standby team in place' },
      { id: 'communications', label: 'Communications between entrants and top person established' },
      { id: 'entry_log', label: 'Entry / exit log ready at the point of entry' },
      {
        id: 'competence_verified',
        label: 'Confined-space training of all entrants verified as current',
      },
    ],
  },
  {
    category: 'work_at_height',
    name: 'Work at height',
    requiresAuthoriser: false,
    requiresGasTesting: false,
    requiresIsolationCertificate: false,
    requiresRescuePlan: true,
    maxDurationHours: 12,
    preconditions: [
      { id: 'equipment_inspected', label: 'Access equipment inspected and in date' },
      { id: 'fall_protection', label: 'Fall prevention / arrest measures in place' },
      { id: 'exclusion_zone', label: 'Exclusion zone established below the work area' },
      { id: 'weather_acceptable', label: 'Weather conditions checked and acceptable' },
      { id: 'rescue_plan', label: 'Rescue plan in place and understood' },
      { id: 'competence_verified', label: 'Competence of all operatives verified' },
    ],
  },
  {
    category: 'electrical',
    name: 'Electrical isolation & live working',
    requiresAuthoriser: true,
    requiresGasTesting: false,
    requiresIsolationCertificate: true,
    requiresRescuePlan: false,
    maxDurationHours: 8,
    preconditions: [
      { id: 'proved_dead', label: 'Isolation proved dead at the point of work' },
      { id: 'locked_tagged', label: 'Locks and tags applied to all isolation points' },
      { id: 'test_instrument_proved', label: 'Test instrument proved before and after testing' },
      { id: 'insulated_equipment', label: 'Insulated tools and PPE appropriate to the voltage' },
      { id: 'authorised_person', label: 'Authorised person appointed and present' },
      { id: 'competence_verified', label: 'Electrical competence of all operatives verified' },
    ],
  },
  {
    category: 'excavation',
    name: 'Excavation',
    requiresAuthoriser: false,
    requiresGasTesting: true,
    requiresIsolationCertificate: false,
    requiresRescuePlan: false,
    maxDurationHours: 24,
    preconditions: [
      {
        id: 'services_located',
        label: 'Underground services located, marked and isolated where needed',
      },
      { id: 'support_plan', label: 'Shoring / battering / stepping plan in place for the depth' },
      { id: 'access_egress', label: 'Safe access and egress provided' },
      { id: 'spoil_clear', label: 'Spoil and materials stored clear of the excavation edge' },
      { id: 'barriers_signage', label: 'Barriers and signage in place around the excavation' },
      { id: 'competence_verified', label: 'Competence of all operatives verified' },
    ],
  },
  {
    category: 'roof_work',
    name: 'Roof work',
    requiresAuthoriser: false,
    requiresGasTesting: false,
    requiresIsolationCertificate: false,
    requiresRescuePlan: true,
    maxDurationHours: 12,
    preconditions: [
      { id: 'fragile_identified', label: 'Fragile surfaces identified and protected or avoided' },
      { id: 'edge_protection', label: 'Edge protection or restraint systems in place' },
      { id: 'weather_acceptable', label: 'Weather conditions checked and acceptable' },
      { id: 'exclusion_zone', label: 'Exclusion zone established below the roof area' },
      { id: 'rescue_plan', label: 'Rescue plan in place and understood' },
      { id: 'competence_verified', label: 'Competence of all operatives verified' },
    ],
  },
  {
    category: 'asbestos',
    name: 'Asbestos-related work',
    requiresAuthoriser: true,
    requiresGasTesting: false,
    requiresIsolationCertificate: false,
    requiresRescuePlan: false,
    maxDurationHours: 24,
    preconditions: [
      { id: 'register_consulted', label: 'Asbestos register / survey consulted for the work area' },
      {
        id: 'licensed_confirmed',
        label: 'Licensed contractor confirmed where the work is licensable',
      },
      {
        id: 'controls_in_place',
        label: 'Enclosure / controls and decontamination arrangements in place',
      },
      { id: 'waste_route', label: 'Hazardous-waste route and consignment arrangements agreed' },
      { id: 'air_monitoring', label: 'Air monitoring arranged where required' },
      {
        id: 'competence_verified',
        label: 'Asbestos training of all operatives verified as current',
      },
    ],
  },
  {
    category: 'lifting',
    name: 'Lifting operations',
    requiresAuthoriser: true,
    requiresGasTesting: false,
    requiresIsolationCertificate: false,
    requiresRescuePlan: false,
    maxDurationHours: 12,
    preconditions: [
      { id: 'lift_plan', label: 'Lift plan prepared for the load and configuration' },
      {
        id: 'equipment_examined',
        label: 'Lifting equipment thoroughly examined and certificates current',
      },
      { id: 'appointed_person', label: 'Appointed person named and in control of the lift' },
      { id: 'exclusion_zone', label: 'Exclusion zone established under the load path' },
      {
        id: 'ground_conditions',
        label: 'Ground conditions assessed for outriggers / crane standing',
      },
      { id: 'competence_verified', label: 'Operator and slinger / signaller competence verified' },
    ],
  },
  {
    category: 'pressure_systems',
    name: 'Pressure system work',
    requiresAuthoriser: true,
    requiresGasTesting: false,
    requiresIsolationCertificate: true,
    requiresRescuePlan: false,
    maxDurationHours: 8,
    preconditions: [
      { id: 'depressurised', label: 'System depressurised, drained and vented' },
      { id: 'isolations_proved', label: 'All isolations proved and secured' },
      { id: 'scheme_consulted', label: 'Written scheme of examination consulted' },
      { id: 'relief_verified', label: 'Relief devices verified and reinstatement plan agreed' },
      { id: 'competence_verified', label: 'Competence of all operatives verified' },
    ],
  },
];

export const DEFAULT_PERMIT_TYPES: ReadonlyArray<DefaultPermitType> = DEFAULT_PERMIT_TYPE_BASES.map(
  (base) => ({
    ...base,
    gasLimits: DEFAULT_GAS_LIMITS[base.category] ?? [],
    gasTestMaxAgeMinutes:
      base.category === 'confined_space' ? 30 : DEFAULT_GAS_TEST_MAX_AGE_MINUTES,
  }),
);
