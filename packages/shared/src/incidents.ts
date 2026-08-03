/**
 * Incident & accident management domain helpers (FreeHS module B5).
 *
 * Pure data + functions shared by the DB schema, the API router, the web
 * UI and the notification workers:
 *   - the incident kind / severity / status vocabularies and the strict
 *     lifecycle state machine (`canTransition`) — the router refuses any
 *     move not in this matrix;
 *   - per-kind `details` Zod schemas (the permits jsonb-payload pattern):
 *     sharps exposures, violence & aggression, dangerous occurrences,
 *     damage and environmental releases each carry a validated block;
 *   - the per-person injury block (body parts, injury kinds, first aid,
 *     hospitalisation) and the lost-time calculator implementing the
 *     RIDDOR counting rule (exclude the day of the accident, count
 *     weekends, accumulate across periods);
 *   - the RIDDOR duty engine primitives: category vocabulary, deadline
 *     computation per category, and the over-7-day tripwire that flags a
 *     "not reportable" determination for re-screening;
 *   - investigation primitives: levels, RCA method vocabularies, the
 *     why-chain and causal-factor schemas, finding priorities;
 *   - effectiveness-review scheduling (clause 10.2's forgotten step).
 *
 * Everything here is deterministic and side-effect free so the tRPC
 * layer, client components and the workers can all import it. Dates that
 * represent calendar days (absence periods) travel as `YYYY-MM-DD`
 * strings and are computed in UTC to stay timezone-stable.
 */
import { z } from 'zod';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// ─── Kinds ──────────────────────────────────────────────────────────────────

/**
 * Workplace safety event kinds. Staff H&S incidents only — patient-safety
 * / clinical incident management is explicitly out of scope. `near_miss`
 * normally lives in observations; it exists here for near misses
 * escalated from an observation into a full incident record.
 */
export const INCIDENT_KINDS = [
  'injury',
  'ill_health',
  'dangerous_occurrence',
  'sharps_exposure',
  'violence_aggression',
  'damage',
  'environmental',
  'near_miss',
] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export function isIncidentKind(value: unknown): value is IncidentKind {
  return typeof value === 'string' && (INCIDENT_KINDS as readonly string[]).includes(value);
}

/** Kinds whose records default to confidential at creation (Aisha's condition). */
export const CONFIDENTIAL_BY_DEFAULT_KINDS: ReadonlyArray<IncidentKind> = [
  'sharps_exposure',
  'violence_aggression',
];

export function defaultConfidential(kind: IncidentKind): boolean {
  return CONFIDENTIAL_BY_DEFAULT_KINDS.includes(kind);
}

// ─── Severity ───────────────────────────────────────────────────────────────

/** Actual-outcome severity, set at triage, frozen once the investigation is approved. */
export const INCIDENT_SEVERITIES = ['negligible', 'minor', 'moderate', 'serious', 'major'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export function severityRank(severity: IncidentSeverity): number {
  return INCIDENT_SEVERITIES.indexOf(severity);
}

export function isSeriousOrAbove(severity: IncidentSeverity): boolean {
  return severityRank(severity) >= severityRank('serious');
}

/**
 * Kinds that always trigger the immediate alert fan-out regardless of
 * severity — a dangerous occurrence, a sharps exposure or a violent
 * episode needs eyes on it even when the outcome was mild.
 */
export const ALERT_KINDS: ReadonlyArray<IncidentKind> = [
  'dangerous_occurrence',
  'sharps_exposure',
  'violence_aggression',
];

export function needsImmediateAlert(kind: IncidentKind, severity: IncidentSeverity): boolean {
  return ALERT_KINDS.includes(kind) || isSeriousOrAbove(severity);
}

/**
 * Provisional severity at report time (HSE review IN-A2). The reporter
 * may offer a severity judgement; independently, the hospitalisation
 * facts collected per person floor it — a hospital admission means at
 * least `serious`, an A&E attendance at least `moderate` — so the
 * immediate-alert predicate can fire from the facts on the form even
 * when the reporter skipped the judgement. Triage still owns the
 * definitive severity; this only stops a serious injury sitting
 * invisible under a default "minor" chip until someone opens it.
 */
export function provisionalSeverity(
  reported: IncidentSeverity | undefined,
  hospitalisations: readonly Hospitalisation[],
): IncidentSeverity {
  const base: IncidentSeverity = reported ?? 'minor';
  const floor: IncidentSeverity | null = hospitalisations.includes('admitted')
    ? 'serious'
    : hospitalisations.includes('ae')
      ? 'moderate'
      : null;
  return floor !== null && severityRank(floor) > severityRank(base) ? floor : base;
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export const INCIDENT_STATUSES = [
  'reported',
  'triaged',
  'investigating',
  'actions_outstanding',
  'closed',
  'reopened',
  'cancelled',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Statuses that still need work — everything except the two terminal states. */
export const OPEN_INCIDENT_STATUSES = [
  'reported',
  'triaged',
  'investigating',
  'actions_outstanding',
  'reopened',
] as const;

export function isOpenIncidentStatus(status: IncidentStatus): boolean {
  return (OPEN_INCIDENT_STATUSES as readonly string[]).includes(status);
}

/**
 * The lifecycle state machine. `investigating → actions_outstanding`
 * happens on investigation approval; `closed` additionally requires every
 * linked action terminal and the RIDDOR duty discharged (router-enforced
 * preconditions on top of this matrix). `reopened` is the recurrence /
 * new-information path: the prior investigation stays immutable and a new
 * revision starts. `cancelled` (duplicate / raised in error) is reachable
 * from any pre-closed state and requires a reason.
 */
const INCIDENT_TRANSITIONS: Record<IncidentStatus, ReadonlyArray<IncidentStatus>> = {
  reported: ['triaged', 'cancelled'],
  triaged: ['investigating', 'cancelled'],
  investigating: ['actions_outstanding', 'cancelled'],
  actions_outstanding: ['closed', 'cancelled'],
  closed: ['reopened'],
  reopened: ['investigating', 'cancelled'],
  cancelled: [],
};

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return INCIDENT_TRANSITIONS[from].includes(to);
}

/** Late reporting is legal but visible: a gap above this is chip-flagged. */
export const LATE_REPORT_THRESHOLD_HOURS = 24;

export function isLateReport(occurredAt: Date, reportedAt: Date): boolean {
  return reportedAt.getTime() - occurredAt.getTime() > LATE_REPORT_THRESHOLD_HOURS * HOUR_MS;
}

// ─── People on an incident ──────────────────────────────────────────────────

/** Who the affected person is to the organisation — non-users get hurt too. */
export const PERSON_CATEGORIES = [
  'employee',
  'contractor',
  'agency',
  'visitor',
  'member_of_public',
  'work_experience',
] as const;
export type PersonCategory = (typeof PERSON_CATEGORIES)[number];

/** Standard HSE-flavoured body-part codes (multi-select on the injury block). */
export const BODY_PARTS = [
  'head',
  'face',
  'eye',
  'neck',
  'shoulder',
  'arm',
  'elbow',
  'wrist',
  'hand',
  'finger',
  'trunk',
  'back',
  'abdomen',
  'hip',
  'leg',
  'knee',
  'ankle',
  'foot',
  'toe',
  'internal',
  'multiple',
] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

/** Standard injury-kind codes (multi-select on the injury block). */
export const INJURY_KINDS = [
  'fracture',
  'dislocation',
  'sprain_strain',
  'laceration',
  'puncture',
  'abrasion',
  'bruising',
  'burn',
  'scald',
  'amputation',
  'crush',
  'concussion',
  'electric_shock',
  'asphyxia',
  'poisoning',
  'other',
] as const;
export type InjuryKind = (typeof INJURY_KINDS)[number];

export const HOSPITALISATIONS = ['none', 'ae', 'admitted'] as const;
export type Hospitalisation = (typeof HOSPITALISATIONS)[number];

/**
 * The per-person injury block (`incident_persons.injury` jsonb). Used for
 * injury / ill-health incidents, and for sharps or violence records where
 * a person was physically hurt. "First aid administered by X" is the full
 * extent of treatment recording — clinical records belong to OH.
 */
export const personInjurySchema = z
  .object({
    bodyParts: z.array(z.enum(BODY_PARTS)).max(BODY_PARTS.length).default([]),
    injuryKinds: z.array(z.enum(INJURY_KINDS)).max(INJURY_KINDS.length).default([]),
    firstAidGiven: z.boolean().default(false),
    firstAidBy: z.string().trim().max(200).optional(),
    hospitalisation: z.enum(HOSPITALISATIONS).default('none'),
    treatmentNote: z.string().trim().max(2000).optional(),
  })
  .strict();
export type PersonInjury = z.infer<typeof personInjurySchema>;

// ─── Per-kind details (incidents.details jsonb) ─────────────────────────────

export const CONTAMINATION_STATUSES = ['unknown', 'low', 'high'] as const;

/** Sharps / splash exposure block (NHS priority kind). */
export const sharpsExposureDetailsSchema = z
  .object({
    device: z.string().trim().min(1).max(300),
    procedure: z.string().trim().max(300).optional(),
    sourceKnown: z.boolean().default(false),
    sourceRiskAssessed: z.boolean().default(false),
    sourceRiskNote: z.string().trim().max(1000).optional(),
    contaminationStatus: z.enum(CONTAMINATION_STATUSES).default('unknown'),
    ohFollowUpRequired: z.boolean().default(true),
    washedConfirmed: z.boolean().default(false),
  })
  .strict();
export type SharpsExposureDetails = z.infer<typeof sharpsExposureDetailsSchema>;

export const VA_NATURES = ['physical', 'verbal', 'threat', 'sexual'] as const;
export const PERPETRATOR_TYPES = [
  'patient_or_service_user',
  'visitor',
  'member_of_public',
  'colleague',
  'other',
] as const;

/** Violence & aggression block (NHS priority kind). */
export const violenceAggressionDetailsSchema = z
  .object({
    nature: z.enum(VA_NATURES),
    perpetratorType: z.enum(PERPETRATOR_TYPES),
    weaponInvolved: z.boolean().default(false),
    policeNotified: z.boolean().default(false),
    crimeReference: z.string().trim().max(100).optional(),
    supportOffered: z.boolean().default(false),
    supportNote: z.string().trim().max(1000).optional(),
  })
  .strict();
export type ViolenceAggressionDetails = z.infer<typeof violenceAggressionDetailsSchema>;

/** The common RIDDOR Schedule-2 families, plus `other` with free text. */
export const DANGEROUS_OCCURRENCE_CATEGORIES = [
  'lifting_equipment_collapse',
  'scaffold_collapse',
  'electrical_fire_explosion',
  'pressure_system_failure',
  'accidental_release',
  'structural_collapse',
  'other',
] as const;

export const dangerousOccurrenceDetailsSchema = z
  .object({
    category: z.enum(DANGEROUS_OCCURRENCE_CATEGORIES),
    otherText: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.category === 'other' && (val.otherText === undefined || val.otherText === '')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'other-text-required' });
    }
  });
export type DangerousOccurrenceDetails = z.infer<typeof dangerousOccurrenceDetailsSchema>;

export const COST_BANDS = ['unknown', 'under_1k', '1k_to_10k', '10k_to_100k', 'over_100k'] as const;

export const damageDetailsSchema = z
  .object({
    whatDamaged: z.string().trim().min(1).max(500),
    estimatedCostBand: z.enum(COST_BANDS).default('unknown'),
    mitigation: z.string().trim().max(1000).optional(),
  })
  .strict();
export type DamageDetails = z.infer<typeof damageDetailsSchema>;

export const environmentalDetailsSchema = z
  .object({
    whatReleased: z.string().trim().min(1).max(500),
    estimatedCostBand: z.enum(COST_BANDS).default('unknown'),
    containment: z.string().trim().max(1000).optional(),
  })
  .strict();
export type EnvironmentalDetails = z.infer<typeof environmentalDetailsSchema>;

/**
 * Injury, ill-health and near-miss incidents carry their substance on the
 * incident row (description) and the per-person injury blocks — the
 * kind-level details object is deliberately empty for them.
 */
const emptyDetailsSchema = z.object({}).strict();

const INCIDENT_DETAILS_SCHEMAS: Record<IncidentKind, z.ZodTypeAny> = {
  injury: emptyDetailsSchema,
  ill_health: emptyDetailsSchema,
  dangerous_occurrence: dangerousOccurrenceDetailsSchema,
  sharps_exposure: sharpsExposureDetailsSchema,
  violence_aggression: violenceAggressionDetailsSchema,
  damage: damageDetailsSchema,
  environmental: environmentalDetailsSchema,
  near_miss: emptyDetailsSchema,
};

export type IncidentDetails =
  | Record<string, never>
  | SharpsExposureDetails
  | ViolenceAggressionDetails
  | DangerousOccurrenceDetails
  | DamageDetails
  | EnvironmentalDetails;

/**
 * Validate a `details` payload against the schema for its kind. Throws
 * (ZodError, or Error for an unknown kind) — run at every boundary where
 * a details object crosses in from a client or out of the DB.
 */
export function parseIncidentDetails(kind: string, value: unknown): IncidentDetails {
  if (!isIncidentKind(kind)) {
    throw new Error(`unknown-incident-kind:${kind}`);
  }
  return INCIDENT_DETAILS_SCHEMAS[kind].parse(value ?? {}) as IncidentDetails;
}

// ─── Lost time (the RIDDOR counting rule) ───────────────────────────────────

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isoDateSchema = z.string().regex(ISO_DATE_RE);

export interface AbsencePeriod {
  /** First calendar day off work, `YYYY-MM-DD`. */
  fromDate: string;
  /** Last calendar day off work, `YYYY-MM-DD`; null = still absent. */
  toDate: string | null;
}

export function isoDateToUtcMs(date: string): number {
  if (!ISO_DATE_RE.test(date)) {
    throw new Error(`invalid-iso-date:${date}`);
  }
  const parts = date.split('-');
  const year = Number(parts[0] ?? Number.NaN);
  const month = Number(parts[1] ?? Number.NaN);
  const day = Number(parts[2] ?? Number.NaN);
  const ms = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(ms)) {
    throw new Error(`invalid-iso-date:${date}`);
  }
  return ms;
}

/**
 * Total calendar days lost across absence periods, per the RIDDOR
 * counting rule: the day of the accident is excluded, weekends and rest
 * days are counted, and periods accumulate. Overlapping periods are
 * merged first so a day is never counted twice. Open-ended periods
 * (`toDate: null`) count up to `asOfDate`; periods that have not started
 * by `asOfDate` count zero.
 */
export function totalDaysLost(
  absences: ReadonlyArray<AbsencePeriod>,
  occurredDate: string,
  asOfDate: string,
): number {
  const asOfMs = isoDateToUtcMs(asOfDate);
  const spans: Array<{ start: number; end: number }> = [];
  for (const period of absences) {
    const start = isoDateToUtcMs(period.fromDate);
    if (start > asOfMs) continue;
    const rawEnd = period.toDate === null ? asOfMs : isoDateToUtcMs(period.toDate);
    const end = Math.min(rawEnd, asOfMs);
    if (end < start) continue;
    spans.push({ start, end });
  }
  spans.sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.start <= last.end + DAY_MS) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  const occurredMs = isoDateToUtcMs(occurredDate);
  let days = 0;
  for (const span of merged) {
    days += Math.round((span.end - span.start) / DAY_MS) + 1;
    if (occurredMs >= span.start && occurredMs <= span.end) {
      days -= 1;
    }
  }
  return days;
}

/**
 * The over-7-day tripwire: true when accumulated absence has crossed
 * seven days. When it fires against a `not_reportable` determination the
 * incident is flagged for re-screening (`needsRiddorRescreen`) — the trap
 * a small contractor would otherwise fall into.
 */
export function overSevenDayTripwire(
  absences: ReadonlyArray<AbsencePeriod>,
  occurredDate: string,
  asOfDate: string,
): boolean {
  return totalDaysLost(absences, occurredDate, asOfDate) > 7;
}

// ─── RIDDOR duty engine ─────────────────────────────────────────────────────

/**
 * Guided-determination outcome categories. The platform computes what the
 * answers imply and tracks the clock; a named human owns the judgement.
 * A negative determination (`not_reportable`) is itself a defensible
 * record and renders in the register and PDF.
 */
export const RIDDOR_CATEGORIES = [
  'not_reportable',
  'death',
  'specified_injury',
  'over_7_day',
  'occupational_disease',
  'dangerous_occurrence',
  'gas_incident',
] as const;
export type RiddorCategory = (typeof RIDDOR_CATEGORIES)[number];

export function isRiddorReportable(category: RiddorCategory): boolean {
  return category !== 'not_reportable';
}

/**
 * Report deadline in days per category: deaths, specified injuries,
 * dangerous occurrences and gas incidents must be reported within 10
 * days of the incident; over-7-day injuries within 15 days. Occupational
 * disease follows the 10-day convention from the date the duty arises.
 */
export const RIDDOR_REPORT_DAYS: Record<Exclude<RiddorCategory, 'not_reportable'>, number> = {
  death: 10,
  specified_injury: 10,
  over_7_day: 15,
  occupational_disease: 10,
  dangerous_occurrence: 10,
  gas_incident: 10,
};

export function riddorDeadlineFor(category: RiddorCategory, occurredAt: Date): Date | null {
  if (category === 'not_reportable') return null;
  return new Date(occurredAt.getTime() + RIDDOR_REPORT_DAYS[category] * DAY_MS);
}

/**
 * True when an existing determination must be revisited because the
 * lost-time record contradicts it (accumulated absence crossed 7 days
 * against a "not reportable" screening).
 */
export function needsRiddorRescreen(category: RiddorCategory | null, daysLost: number): boolean {
  return category === 'not_reportable' && daysLost > 7;
}

export const RIDDOR_SUBMISSION_ROUTES = ['online', 'phone'] as const;
export type RiddorSubmissionRoute = (typeof RIDDOR_SUBMISSION_ROUTES)[number];

/** The riddor-deadline-watch worker warns at T-5 and T-2 days, then escalates past the deadline. */
export const RIDDOR_WARNING_DAYS = [5, 2] as const;

// ─── Investigation ──────────────────────────────────────────────────────────

/**
 * Proportionate by design: `basic` is one screen completable on a phone
 * in minutes; `full` is the complete evidence / RCA / findings workspace.
 * Mandatory `full` when severity is serious-or-above or the incident is
 * RIDDOR-reportable. Upgrades are allowed any time; never a downgrade
 * once evidence exists (router-enforced).
 */
export const INVESTIGATION_LEVELS = ['basic', 'full'] as const;
export type InvestigationLevel = (typeof INVESTIGATION_LEVELS)[number];

export function defaultInvestigationLevel(
  severity: IncidentSeverity,
  riddorReportable: boolean,
): InvestigationLevel {
  return isSeriousOrAbove(severity) || riddorReportable ? 'full' : 'basic';
}

export const INVESTIGATION_STATUSES = ['draft', 'submitted', 'approved'] as const;
export type InvestigationStatus = (typeof INVESTIGATION_STATUSES)[number];

export const RCA_METHODS = ['five_whys', 'causal_factors', 'other'] as const;
export type RcaMethod = (typeof RCA_METHODS)[number];

/** The HSG245-flavoured causal-factor families (also the finding categories). */
export const CAUSAL_FACTOR_CATEGORIES = [
  'equipment_guarding',
  'procedure',
  'training_competence',
  'supervision',
  'human_factors',
  'environment',
  'maintenance',
  'management_system',
] as const;
export type CausalFactorCategory = (typeof CAUSAL_FACTOR_CATEGORIES)[number];

/**
 * Five-whys chain: 2–7 ordered entries; at most one may be marked as the
 * root cause and it must be the final entry.
 */
export const whyChainSchema = z
  .array(
    z
      .object({
        text: z.string().trim().min(1).max(1000),
        isRootCause: z.boolean().default(false),
      })
      .strict(),
  )
  .min(2)
  .max(7)
  .superRefine((chain, ctx) => {
    const rootIndexes = chain.flatMap((entry, index) => (entry.isRootCause ? [index] : []));
    if (rootIndexes.length > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'multiple-root-causes' });
    } else if (rootIndexes.length === 1 && rootIndexes[0] !== chain.length - 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'root-cause-not-last' });
    }
  });
export type WhyChain = z.infer<typeof whyChainSchema>;

export const causalFactorsSchema = z
  .array(
    z
      .object({
        category: z.enum(CAUSAL_FACTOR_CATEGORIES),
        narrative: z.string().trim().min(1).max(2000),
      })
      .strict(),
  )
  .min(1)
  .max(20);
export type CausalFactors = z.infer<typeof causalFactorsSchema>;

/** Optional ordered "what happened when" rows the report renders as a sequence. */
export const timelineEntriesSchema = z
  .array(
    z
      .object({
        at: z.string().trim().max(100),
        text: z.string().trim().min(1).max(1000),
      })
      .strict(),
  )
  .max(50);
export type TimelineEntries = z.infer<typeof timelineEntriesSchema>;

/** Matches the actions engine's priority vocabulary so findings map 1:1. */
export const FINDING_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type FindingPriority = (typeof FINDING_PRIORITIES)[number];

export const RECURRENCE_LIKELIHOODS = ['low', 'medium', 'high'] as const;
export type RecurrenceLikelihood = (typeof RECURRENCE_LIKELIHOODS)[number];

// ─── Evidence & witnesses ───────────────────────────────────────────────────

/**
 * Evidence item kinds. CCTV is a reference (location, clip window,
 * retention deadline in the caption) — video is never ingested.
 */
export const EVIDENCE_KINDS = ['photo', 'document', 'cctv_ref', 'physical_ref', 'other'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

// ─── Effectiveness review (clause 10.2) ─────────────────────────────────────

export const EFFECTIVENESS_VERDICTS = [
  'effective',
  'partially_effective',
  'not_effective',
] as const;
export type EffectivenessVerdict = (typeof EFFECTIVENESS_VERDICTS)[number];

export const DEFAULT_EFFECTIVENESS_REVIEW_DAYS = 90;
export const MIN_EFFECTIVENESS_REVIEW_DAYS = 30;
export const MAX_EFFECTIVENESS_REVIEW_DAYS = 365;

/**
 * When the post-closure effectiveness review falls due. Days outside the
 * tenant-configurable 30–365 window are clamped into it.
 */
export function effectivenessDueAt(
  closedAt: Date,
  days: number = DEFAULT_EFFECTIVENESS_REVIEW_DAYS,
): Date {
  const clamped = Math.min(
    MAX_EFFECTIVENESS_REVIEW_DAYS,
    Math.max(MIN_EFFECTIVENESS_REVIEW_DAYS, Math.round(days)),
  );
  return new Date(closedAt.getTime() + clamped * DAY_MS);
}

// ─── Chase digest ───────────────────────────────────────────────────────────

/** Investigations untouched for longer than this land in the daily chase digest. */
export const INVESTIGATION_IDLE_CHASE_DAYS = 14;

// ─── References ─────────────────────────────────────────────────────────────

export const INCIDENT_REFERENCE_PREFIX = 'IN-';

/**
 * `IN-` + 6-digit zero-pad. `padStart` never truncates, so the series
 * grows naturally past IN-999999 (IN-1000000, …).
 */
export function formatIncidentReference(value: number): string {
  return `${INCIDENT_REFERENCE_PREFIX}${String(value).padStart(6, '0')}`;
}
