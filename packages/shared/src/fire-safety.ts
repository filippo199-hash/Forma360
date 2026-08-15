/**
 * Fire Safety domain helpers (FreeHS module B4).
 *
 * Pure data + functions shared by the DB schema, the API router and the
 * web UI:
 *   - the fire-safety check catalogue (the logbook calendar): every
 *     recurring check type with its conventional statutory / BS-standard
 *     frequency and the building profile that makes it applicable;
 *   - due-date arithmetic for check frequencies (calendar-month based,
 *     month-end clamped) and the ok / due-soon / overdue status maths;
 *   - building classification under the Fire Safety (England)
 *     Regulations 2022: high-rise residential (≥ 18 m or ≥ 7 storeys)
 *     and the above-11-metre residential regime;
 *   - the fire-door inspection regime (quarterly common-parts and annual
 *     flat-entrance checks in relevant residential buildings above
 *     eleven metres; six-monthly best practice elsewhere);
 *   - fire-risk-assessment vocabulary (methodology, PAS 79-style
 *     five-band risk rating, significant-finding categories) and the
 *     review-cadence suggestion derived from the rating.
 *
 * Everything here is deterministic and side-effect free so both the tRPC
 * layer and client components can import it.
 */
import { z } from 'zod';
import { trainingStatus } from './training';

// ─── Check frequencies ──────────────────────────────────────────────────────

export const CHECK_FREQUENCIES = [
  'weekly',
  'monthly',
  'quarterly',
  'six_monthly',
  'annual',
] as const;
export type CheckFrequency = (typeof CHECK_FREQUENCIES)[number];

const FREQUENCY_MONTHS: Record<Exclude<CheckFrequency, 'weekly'>, number> = {
  monthly: 1,
  quarterly: 3,
  six_monthly: 6,
  annual: 12,
};

/**
 * Add calendar months, clamping to the last day of the target month —
 * 31 January + 1 month is 28/29 February, never 2/3 March. A logbook
 * that silently drifts into the next month teaches people to distrust
 * its dates.
 */
export function addMonthsClamped(base: Date, months: number): Date {
  const out = new Date(base);
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

/** Next due date for a check performed (or scheduled from) `from`. */
export function nextDueDate(from: Date, frequency: CheckFrequency): Date {
  if (frequency === 'weekly') {
    const out = new Date(from);
    out.setUTCDate(out.getUTCDate() + 7);
    return out;
  }
  return addMonthsClamped(from, FREQUENCY_MONTHS[frequency]);
}

/**
 * How close to the due date the module starts flagging "due soon".
 * Scaled to the cadence: two days of warning is right for a weekly
 * alarm test, useless for an annual extinguisher service.
 */
export const DUE_SOON_DAYS: Record<CheckFrequency, number> = {
  weekly: 2,
  monthly: 7,
  quarterly: 14,
  six_monthly: 21,
  annual: 30,
};

export type CheckDueStatus = 'ok' | 'due_soon' | 'overdue';

/** Classify a due date against now. Boundary rule: due exactly now = overdue. */
export function checkDueStatus(
  nextDueAt: Date,
  frequency: CheckFrequency,
  now: Date,
): CheckDueStatus {
  if (nextDueAt.getTime() <= now.getTime()) return 'overdue';
  const windowMs = DUE_SOON_DAYS[frequency] * 24 * 60 * 60 * 1000;
  if (nextDueAt.getTime() - now.getTime() <= windowMs) return 'due_soon';
  return 'ok';
}

/**
 * What the calendar shows (HSE review FS-1). The due-date maths above is
 * pure clock; this layer adds the safety rule: a check whose newest
 * recorded result is a FAIL stays in a distinct red "failed" state —
 * regardless of the next due date — until a subsequent pass clears it.
 * Advancing the schedule must never make a failed alarm test read green.
 *
 * 'defects_found' does not hold the state: the measure works, defects
 * are being remedied through the raised action (FS-2). 'fail' means the
 * safety measure itself does not work.
 */
export type CheckDisplayStatus = CheckDueStatus | 'failed';

export function checkDisplayStatus(
  nextDueAt: Date,
  frequency: CheckFrequency,
  lastResult: 'pass' | 'defects_found' | 'fail' | null,
  now: Date,
): CheckDisplayStatus {
  if (lastResult === 'fail') return 'failed';
  return checkDueStatus(nextDueAt, frequency, now);
}

// ─── Building classification ────────────────────────────────────────────────

/** The subset of a building record the classification helpers read. */
export interface FireBuildingProfile {
  isResidential: boolean;
  /** Height of the top occupied storey above ground, metres; null = unknown. */
  heightMetres: number | null;
  storeys: number | null;
  hasFireAlarm: boolean;
  hasEmergencyLighting: boolean;
  hasSprinklers: boolean;
  hasDampers: boolean;
  hasRisers: boolean;
}

/**
 * High-rise residential per the Fire Safety (England) Regulations 2022:
 * a residential building at least 18 metres tall OR with at least
 * 7 storeys. Triggers the secure information box, external wall system
 * information, floor plans for the fire and rescue service, monthly
 * firefighting-lift/equipment checks and wayfinding signage duties.
 */
export function isHighRiseResidential(profile: FireBuildingProfile): boolean {
  if (!profile.isResidential) return false;
  return (
    (profile.heightMetres !== null && profile.heightMetres >= 18) ||
    (profile.storeys !== null && profile.storeys >= 7)
  );
}

/**
 * The above-11-metre residential regime (Regulation 10): quarterly checks
 * of fire doors in common parts and annual checks of flat entrance doors.
 * Strictly *above* 11 m — an 11.0 m building is out. A building that
 * qualifies as high-rise by storey count qualifies here too even when its
 * height is unrecorded (18 m ⊃ 11 m).
 */
export function isAbove11mResidential(profile: FireBuildingProfile): boolean {
  if (!profile.isResidential) return false;
  if (profile.heightMetres !== null && profile.heightMetres > 11) return true;
  return isHighRiseResidential(profile);
}

// ─── The check catalogue (the logbook calendar) ─────────────────────────────

/**
 * Recurring fire-safety checks the logbook carries. Fire-door checks are
 * NOT in this catalogue — doors are inspectable assets with per-door due
 * dates (see {@link doorInspectionIntervalMonths}); the overview merges
 * both calendars.
 */
export const FIRE_CHECK_TYPES = [
  'alarm_test',
  'detection_service',
  'emergency_lighting_function',
  'emergency_lighting_duration',
  'extinguisher_visual',
  'extinguisher_service',
  'sprinkler_check',
  'riser_service',
  'damper_test',
  'fire_drill',
  'lift_firefighting_check',
  'secure_info_box_check',
  'wayfinding_signage_check',
] as const;
export type FireCheckType = (typeof FIRE_CHECK_TYPES)[number];

/**
 * What a logbook check ROW can be typed as: a catalogue type, or
 * 'custom' — a manager-added check the catalogue doesn't know about
 * (its display name lives in the row's `label`). Uniqueness per
 * building × type is only enforced for catalogue types; several
 * custom checks may coexist on one building.
 */
export type LogbookCheckType = FireCheckType | 'custom';

const FIRE_CHECK_TYPE_SET: ReadonlySet<string> = new Set(FIRE_CHECK_TYPES);

export function isFireCheckType(value: unknown): value is FireCheckType {
  return typeof value === 'string' && FIRE_CHECK_TYPE_SET.has(value);
}

/** What makes a catalogue check applicable to a building. */
export type CheckApplicability =
  | 'always'
  | 'fire_alarm'
  | 'emergency_lighting'
  | 'sprinklers'
  | 'dampers'
  | 'risers'
  | 'high_rise_residential';

export interface FireCheckTypeSpec {
  /**
   * Conventional frequency: weekly alarm test (BS 5839-1), monthly
   * emergency-lighting function test + annual duration test (BS 5266-1),
   * monthly extinguisher visual + annual service (BS 5306-3), weekly
   * sprinkler checks (BS EN 12845), six-monthly riser service (BS 9990),
   * annual damper test (BS 9999), and the monthly high-rise duties from
   * the Fire Safety (England) Regulations 2022.
   */
  defaultFrequency: CheckFrequency;
  appliesWhen: CheckApplicability;
}

export const FIRE_CHECK_TYPE_SPECS: Record<FireCheckType, FireCheckTypeSpec> = {
  alarm_test: { defaultFrequency: 'weekly', appliesWhen: 'fire_alarm' },
  detection_service: { defaultFrequency: 'six_monthly', appliesWhen: 'fire_alarm' },
  emergency_lighting_function: { defaultFrequency: 'monthly', appliesWhen: 'emergency_lighting' },
  emergency_lighting_duration: { defaultFrequency: 'annual', appliesWhen: 'emergency_lighting' },
  extinguisher_visual: { defaultFrequency: 'monthly', appliesWhen: 'always' },
  extinguisher_service: { defaultFrequency: 'annual', appliesWhen: 'always' },
  sprinkler_check: { defaultFrequency: 'weekly', appliesWhen: 'sprinklers' },
  riser_service: { defaultFrequency: 'six_monthly', appliesWhen: 'risers' },
  damper_test: { defaultFrequency: 'annual', appliesWhen: 'dampers' },
  fire_drill: { defaultFrequency: 'six_monthly', appliesWhen: 'always' },
  lift_firefighting_check: { defaultFrequency: 'monthly', appliesWhen: 'high_rise_residential' },
  secure_info_box_check: { defaultFrequency: 'monthly', appliesWhen: 'high_rise_residential' },
  wayfinding_signage_check: { defaultFrequency: 'monthly', appliesWhen: 'high_rise_residential' },
};

/**
 * The check types a building's profile makes applicable — what
 * `setupChecks` seeds. Statutory-or-conventional only; any catalogue
 * check can still be added manually to any building.
 */
export function requiredCheckTypesFor(profile: FireBuildingProfile): FireCheckType[] {
  const highRise = isHighRiseResidential(profile);
  return FIRE_CHECK_TYPES.filter((type) => {
    const spec = FIRE_CHECK_TYPE_SPECS[type];
    switch (spec.appliesWhen) {
      case 'always':
        return true;
      case 'fire_alarm':
        return profile.hasFireAlarm;
      case 'emergency_lighting':
        return profile.hasEmergencyLighting;
      case 'sprinklers':
        return profile.hasSprinklers;
      case 'dampers':
        return profile.hasDampers;
      case 'risers':
        return profile.hasRisers;
      case 'high_rise_residential':
        return highRise;
    }
  });
}

// ─── Fire doors ─────────────────────────────────────────────────────────────

export const FIRE_DOOR_LOCATION_KINDS = ['common_parts', 'flat_entrance', 'other'] as const;
export type FireDoorLocationKind = (typeof FIRE_DOOR_LOCATION_KINDS)[number];

/**
 * Best-practice interval where no statutory regime applies (BS 9999
 * recommends six-monthly fire-door inspection).
 */
export const DEFAULT_DOOR_INSPECTION_MONTHS = 6;

/**
 * Inspection cadence for a door. In residential buildings above 11 m,
 * Regulation 10 of the Fire Safety (England) Regulations 2022 requires
 * quarterly checks of fire doors in common parts and annual (best
 * endeavours) checks of flat entrance doors. A per-door override wins
 * everywhere — some doors earn closer attention than their regime.
 */
export function doorInspectionIntervalMonths(
  locationKind: FireDoorLocationKind,
  profile: FireBuildingProfile,
  overrideMonths?: number | null,
): number {
  if (overrideMonths !== undefined && overrideMonths !== null) return overrideMonths;
  if (isAbove11mResidential(profile)) {
    if (locationKind === 'common_parts') return 3;
    if (locationKind === 'flat_entrance') return 12;
  }
  return DEFAULT_DOOR_INSPECTION_MONTHS;
}

/** Due-soon window for a door given its interval, reusing the check bands. */
export function doorDueStatus(
  nextInspectionDueAt: Date,
  intervalMonths: number,
  now: Date,
): CheckDueStatus {
  const frequency: CheckFrequency =
    intervalMonths <= 1
      ? 'monthly'
      : intervalMonths <= 3
        ? 'quarterly'
        : intervalMonths <= 6
          ? 'six_monthly'
          : 'annual';
  return checkDueStatus(nextInspectionDueAt, frequency, now);
}

/**
 * Door display status — same FS-1 rule as checks: a failed door stays red.
 *
 * BUG-08: this used to test `lastOutcome === 'fail'` alone, so a door
 * inspected as `defects_found` fell through to the due-date branch and showed
 * green "OK" until its next inspection came round. An HSE evaluation caught it
 * — the history recorded the defects and the register said the door was fine.
 *
 * A fire door with defects is not a compliant fire door. Both failing outcomes
 * hold the red state, and only a subsequent PASS clears it, exactly as FS-1
 * intends for logbook checks.
 */
export function doorDisplayStatus(
  nextInspectionDueAt: Date,
  intervalMonths: number,
  lastOutcome: 'pass' | 'defects_found' | 'fail' | null,
  now: Date,
): CheckDisplayStatus {
  if (lastOutcome === 'fail' || lastOutcome === 'defects_found') return 'failed';
  return doorDueStatus(nextInspectionDueAt, intervalMonths, now);
}

/**
 * The five-point fire-door check. `null` = not looked at; the router
 * stores what was actually checked, never assumes.
 */
export const doorChecklistSchema = z.object({
  /** Gaps ≤ 4 mm around the frame, ≤ 8 mm under the door. */
  gapsOk: z.boolean().nullable().default(null),
  /** Intumescent strips / smoke seals intact and unpainted. */
  sealsOk: z.boolean().nullable().default(null),
  /** Self-closer shuts the door fully onto the latch from any angle. */
  closerOk: z.boolean().nullable().default(null),
  /** Glazing / vision panels intact, fire-rated. */
  glazingOk: z.boolean().nullable().default(null),
  /** Hinges firm, three or more, CE/UKCA-marked. */
  hingesOk: z.boolean().nullable().default(null),
  /** Signage present ("Fire door keep shut" / keep locked). */
  signageOk: z.boolean().nullable().default(null),
});
export type DoorChecklist = z.infer<typeof doorChecklistSchema>;

// ─── Fire risk assessment vocabulary ────────────────────────────────────────

export const FRA_METHODOLOGIES = ['pas79', 'hse_five_step', 'other'] as const;
export type FraMethodology = (typeof FRA_METHODOLOGIES)[number];

/** PAS 79-style five-band taken-together risk rating. */
export const FRA_RISK_RATINGS = [
  'trivial',
  'tolerable',
  'moderate',
  'substantial',
  'intolerable',
] as const;
export type FraRiskRating = (typeof FRA_RISK_RATINGS)[number];

export const FRA_FINDING_CATEGORIES = [
  'ignition_sources',
  'fuel_storage',
  'dangerous_substances',
  'means_of_escape',
  'detection_warning',
  'emergency_lighting',
  'compartmentation',
  'fire_doors',
  'external_walls',
  'firefighting_equipment',
  'management',
  'training_drills',
  'signage',
  'arson_security',
  'other',
] as const;
export type FraFindingCategory = (typeof FRA_FINDING_CATEGORIES)[number];

export const FRA_FINDING_PRIORITIES = ['low', 'medium', 'high'] as const;
export type FraFindingPriority = (typeof FRA_FINDING_PRIORITIES)[number];

/**
 * Preset "people at risk" groups; free-text extras are allowed too.
 *
 * BUG-18: `sleeping_occupants` used to sit here AND as the dedicated
 * `sleepingOccupants` boolean beside max occupancy, so the FRA form offered
 * it twice and an assessor could tick one and not the other. The boolean is
 * the load-bearing one — it drives the FSR 2022 regime and is snapshotted
 * into the published version — so the preset is the duplicate that goes. Its
 * label is deliberately kept in the bundle so assessments that already
 * recorded the free-text value still render it.
 */
export const FRA_PERSONS_AT_RISK_PRESETS = [
  'employees',
  'residents',
  'visitors',
  'contractors',
  'young_persons',
  'persons_requiring_assistance',
  'lone_workers',
  'members_of_public',
] as const;

/** Default review cycle — annual is the accepted practitioner baseline. */
export const DEFAULT_FRA_REVIEW_MONTHS = 12;

/**
 * Suggested review cadence from the taken-together risk rating: annual
 * as the floor, tightened when the assessment itself says the risk is
 * not yet controlled.
 */
export function suggestedFraReviewMonths(rating: FraRiskRating | null): number {
  if (rating === 'intolerable') return 3;
  if (rating === 'substantial') return 6;
  return DEFAULT_FRA_REVIEW_MONTHS;
}

// ─── Drills, PEEPs, marshals ────────────────────────────────────────────────

/** Default PEEP review cycle (practitioner default, editable per plan). */
export const DEFAULT_PEEP_REVIEW_MONTHS = 12;

/** How far ahead marshal-training expiry counts as "expiring soon". */
export const MARSHAL_EXPIRY_SOON_DAYS = 60;

export type MarshalTrainingStatus = 'not_trained' | 'in_date' | 'expiring_soon' | 'expired';

/**
 * Training state for one marshal.
 *
 * TR-A13: this is now a thin adapter over `trainingStatus` in
 * `training.ts` rather than a second implementation. The training module
 * lifted its vocabulary from here, as the brief asked — but the
 * consume-back never happened, so two divergent copies coexisted and
 * could drift apart on the boundary cases (an expiry exactly now, a
 * missing expiry) that matter most.
 *
 * The only difference that survives is the name of the "no record" state:
 * fire safety says `not_trained`, the matrix says `not_held`. That is a
 * label on the same fact, and it is translated at this boundary rather
 * than by keeping two status engines.
 */
export function marshalTrainingStatus(
  marshal: { trainedAt: Date | null; trainingExpiresAt: Date | null },
  now: Date,
): MarshalTrainingStatus {
  const status = trainingStatus({
    required: true,
    record:
      marshal.trainedAt === null
        ? null
        : { achievedAt: marshal.trainedAt, expiresAt: marshal.trainingExpiresAt },
    leadDays: MARSHAL_EXPIRY_SOON_DAYS,
    now,
  });
  return status === 'not_held' || status === 'not_required' ? 'not_trained' : status;
}

/**
 * Where a marshal's competence verdict came from (FS-X01).
 *
 * - `training` — a designated training record governs it. The training
 *   matrix is the register that holds certificates, verification status and
 *   evidence keys; when it has an answer, it IS the answer.
 * - `local` — the fire register's own hand-typed dates, with nothing behind
 *   them. Legitimate on a deployment without the Training module; a
 *   liability on one with it, which is why it is labelled rather than
 *   silently trusted.
 * - `none` — no designation configured, so the local dates are all there is
 *   and no claim about backing is being made. The pre-FS-X01 world.
 */
export type MarshalCompetenceSource = 'training' | 'local' | 'none';

export interface MarshalCompetence {
  status: MarshalTrainingStatus;
  source: MarshalCompetenceSource;
  /**
   * True when the fire register is asserting competence that the training
   * matrix cannot corroborate — a date somebody typed with no record behind
   * it, on a tenant that HAS designated what a marshal ticket is.
   *
   * This is the direction that matters most. A renewed certificate that
   * leaves the register red is a false alarm and self-corrects the moment
   * anyone looks. A typed date with nothing behind it is a false all-clear
   * on a statutory duty, it satisfies the building's marshal target, it
   * closes the coverage gap that exists to force the training, and nothing
   * in the product will ever contradict it.
   */
  unbacked: boolean;
  /** Set when the record and the local dates disagree, so the UI can say so. */
  conflictsWithLocal: boolean;
}

/**
 * Reconcile a marshal's competence against the training matrix (FS-X01).
 *
 * `fire_marshals` carried its own `trainedAt` / `trainingExpiresAt` and
 * {@link marshalTrainingStatus} read only that row, so one fact had two
 * registers and they disagreed in both directions. The vocabulary
 * consume-back happened at TR-A13 — this is the data one.
 *
 * The governing record WINS OUTRIGHT; this is deliberately not "best of the
 * two". If the record says expired and the hand-typed date says in-date,
 * rendering green is precisely the bug.
 *
 * `governing` is the most recently achieved non-superseded record the
 * marshal holds against ANY designated requirement (any-of: holding the
 * higher ticket must not be voided by lacking the lower). Resolving it
 * needs the database, so it is passed in — this stays pure and unit-tested.
 */
export function marshalCompetence(
  marshal: { trainedAt: Date | null; trainingExpiresAt: Date | null },
  governing: { achievedAt: Date; expiresAt: Date | null } | null,
  now: Date,
  /** False on a tenant that has not said which requirement is the ticket. */
  designated: boolean,
): MarshalCompetence {
  const localStatus = marshalTrainingStatus(marshal, now);

  if (!designated) {
    return { status: localStatus, source: 'none', unbacked: false, conflictsWithLocal: false };
  }

  if (governing !== null) {
    const status = marshalTrainingStatus(
      { trainedAt: governing.achievedAt, trainingExpiresAt: governing.expiresAt },
      now,
    );
    return {
      status,
      source: 'training',
      unbacked: false,
      conflictsWithLocal: marshal.trainedAt !== null && status !== localStatus,
    };
  }

  // Designated, and the matrix has nothing. A typed date is now visibly an
  // assertion rather than a fact.
  return {
    status: localStatus,
    source: 'local',
    unbacked: marshal.trainedAt !== null,
    conflictsWithLocal: false,
  };
}

// ─── The signed FRA snapshot (FS-G05) ───────────────────────────────────────

/** One significant finding, as it read at sign-off. */
export interface FraVersionFinding {
  id: string;
  category: FraFindingCategory;
  priority: FraFindingPriority;
  description: string;
  requiresAction: boolean;
  /** Null when the finding was still open at sign-off. */
  resolvedAt: string | null;
  sortOrder: number;
}

/**
 * The whole assessment, frozen at the moment a Responsible Person attested
 * it as "suitable and sufficient".
 *
 * Every field the FRA PDF and the FRA page render must be here, or a
 * version cannot be read back without touching the working rows — which
 * would defeat the point. RS-A6 is the precedent: a snapshot builder that
 * omitted one field (`hazards`) shipped versions that could not be used,
 * and the omission had to be tolerated forever with an optional property.
 * So: one interface, one builder, one call site.
 */
export interface FraVersionContent {
  title: string;
  referenceNumber: string | null;
  buildingId: string | null;
  buildingName: string | null;
  premisesDescription: string;
  methodology: FraMethodology;
  responsiblePersonName: string;
  assessorUserId: string | null;
  assessorName: string | null;
  personsAtRisk: readonly string[];
  maxOccupancy: number | null;
  sleepingOccupants: boolean;
  ignitionSources: string;
  fuelSources: string;
  oxygenSources: string;
  evaluationNotes: string;
  riskRating: FraRiskRating;
  reviewFrequencyMonths: number | null;
  nextReviewAt: string | null;
  findings: readonly FraVersionFinding[];
}

/**
 * Build the frozen content. The ONLY place a version's content is
 * constructed — see the RS-A6 note on {@link FraVersionContent}.
 *
 * Dates are ISO strings rather than `Date`: this lands in jsonb, and a
 * `Date` round-trips as a string anyway. Being explicit about it stops a
 * reader from believing they have a `Date` on the way back out.
 */
export function buildFraVersionContent(args: {
  fra: {
    title: string;
    referenceNumber: string | null;
    buildingId: string | null;
    premisesDescription: string;
    methodology: FraMethodology;
    responsiblePersonName: string;
    assessorUserId: string | null;
    assessorName: string | null;
    personsAtRisk: readonly string[];
    maxOccupancy: number | null;
    sleepingOccupants: boolean;
    ignitionSources: string;
    fuelSources: string;
    oxygenSources: string;
    evaluationNotes: string;
    riskRating: FraRiskRating;
    reviewFrequencyMonths: number | null;
  };
  buildingName: string | null;
  nextReviewAt: Date | null;
  findings: ReadonlyArray<{
    id: string;
    category: FraFindingCategory;
    priority: FraFindingPriority;
    description: string;
    requiresAction: boolean;
    resolvedAt: Date | null;
    sortOrder: number;
  }>;
}): FraVersionContent {
  return {
    title: args.fra.title,
    referenceNumber: args.fra.referenceNumber,
    buildingId: args.fra.buildingId,
    buildingName: args.buildingName,
    premisesDescription: args.fra.premisesDescription,
    methodology: args.fra.methodology,
    responsiblePersonName: args.fra.responsiblePersonName,
    assessorUserId: args.fra.assessorUserId,
    assessorName: args.fra.assessorName,
    personsAtRisk: [...args.fra.personsAtRisk],
    maxOccupancy: args.fra.maxOccupancy,
    sleepingOccupants: args.fra.sleepingOccupants,
    ignitionSources: args.fra.ignitionSources,
    fuelSources: args.fra.fuelSources,
    oxygenSources: args.fra.oxygenSources,
    evaluationNotes: args.fra.evaluationNotes,
    riskRating: args.fra.riskRating,
    reviewFrequencyMonths: args.fra.reviewFrequencyMonths,
    nextReviewAt: args.nextReviewAt?.toISOString() ?? null,
    findings: args.findings.map((f) => ({
      id: f.id,
      category: f.category,
      priority: f.priority,
      description: f.description,
      requiresAction: f.requiresAction,
      resolvedAt: f.resolvedAt?.toISOString() ?? null,
      sortOrder: f.sortOrder,
    })),
  };
}

// ─── Building information documents ─────────────────────────────────────────

export const BUILDING_DOCUMENT_KINDS = [
  'floor_plans',
  'building_plan',
  'external_wall_system',
  'fra_report',
  'emergency_plan',
  'other',
] as const;
export type BuildingDocumentKind = (typeof BUILDING_DOCUMENT_KINDS)[number];

/**
 * A reference to an uploaded building-information document (floor plans,
 * single-page building plan, external wall system information, …).
 * Stored as jsonb on the building row; validated at the tRPC boundary.
 */
export const buildingDocumentSchema = z.object({
  kind: z.enum(BUILDING_DOCUMENT_KINDS),
  storageKey: z.string().min(1).max(500),
  filename: z.string().min(1).max(300),
});
export type BuildingDocument = z.infer<typeof buildingDocumentSchema>;

// ─── Bulk door import (HSE review FS-12) ────────────────────────────────────

export interface DoorImportRow {
  doorRef: string;
  floor: string;
  locationKind: FireDoorLocationKind;
}

export interface DoorImportParse {
  rows: DoorImportRow[];
  /** 1-based line numbers that could not be parsed, with the reason. */
  errors: Array<{ line: number; reason: 'empty-ref' | 'bad-kind' }>;
}

const DOOR_KIND_ALIASES: Record<string, FireDoorLocationKind> = {
  flat: 'flat_entrance',
  flat_entrance: 'flat_entrance',
  'flat entrance': 'flat_entrance',
  common: 'common_parts',
  common_parts: 'common_parts',
  'common parts': 'common_parts',
  other: 'other',
};

/**
 * Parse a pasted door register: one door per line,
 * `ref[, floor[, kind]]` (comma or tab separated). A 200-door block
 * should be one paste, not 200 form submissions. Blank lines are
 * skipped; a line whose kind column is unrecognisable is an error (not
 * silently defaulted) so a mis-pasted register is caught, not mangled.
 */
export function parseDoorImport(text: string, defaultKind: FireDoorLocationKind): DoorImportParse {
  const rows: DoorImportRow[] = [];
  const errors: DoorImportParse['errors'] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line.length === 0) return;
    const parts = line.split(/[\t,]/).map((c) => c.trim());
    const doorRef = parts[0] ?? '';
    if (doorRef.length === 0) {
      errors.push({ line: i + 1, reason: 'empty-ref' });
      return;
    }
    const floor = parts[1] ?? '';
    const kindRaw = (parts[2] ?? '').toLowerCase();
    let locationKind = defaultKind;
    if (kindRaw.length > 0) {
      const mapped = DOOR_KIND_ALIASES[kindRaw];
      if (mapped === undefined) {
        errors.push({ line: i + 1, reason: 'bad-kind' });
        return;
      }
      locationKind = mapped;
    }
    rows.push({ doorRef, floor, locationKind });
  });
  return { rows, errors };
}

// ─── Drill outcomes (FS-A1 / BUG-07) ────────────────────────────────────────

/**
 * A drill is only worth running if a bad one changes something.
 *
 * An HSE evaluation logged a drill with an eight-minute evacuation against a
 * six-minute target and a resident unaccounted for — and the product recorded
 * it, marked the schedule satisfied, and raised nothing. The lesson stayed in
 * a free-text box that nobody is chased to read. A failed logbook CHECK
 * already raises an action; the drill, which is the more consequential test,
 * did not.
 *
 * These are the outcomes that must produce a follow-up. Roll problems need no
 * configuration — an unaccounted person is a failure by definition. The time
 * target is per-drill, because a care home and a warehouse do not share one.
 */
export const DRILL_CONCERN_REASONS = [
  'roll_incomplete',
  'people_unaccounted',
  'evacuation_over_target',
] as const;
export type DrillConcernReason = (typeof DRILL_CONCERN_REASONS)[number];

export interface DrillOutcomeInput {
  rollComplete: boolean;
  peoplePresent: number | null;
  peopleAccountedFor: number | null;
  evacuationSeconds: number | null;
  /** Per-drill target; omit when the organisation has not set one. */
  evacuationTargetSeconds?: number | null;
}

/**
 * Every reason this drill needs a follow-up action, worst first. Empty means
 * the drill was clean and nothing is raised.
 */
export function drillConcerns(input: DrillOutcomeInput): DrillConcernReason[] {
  const out: DrillConcernReason[] = [];
  const { peoplePresent: present, peopleAccountedFor: accounted } = input;
  if (present !== null && accounted !== null && accounted < present) {
    out.push('people_unaccounted');
  }
  // An explicit "roll not complete" is a concern even when the numbers were
  // not recorded — it is the marshal saying so.
  if (!input.rollComplete) out.push('roll_incomplete');
  const target = input.evacuationTargetSeconds;
  if (
    input.evacuationSeconds !== null &&
    target !== null &&
    target !== undefined &&
    target > 0 &&
    input.evacuationSeconds > target
  ) {
    out.push('evacuation_over_target');
  }
  return out;
}

/** A drill with any concern must raise an action. */
export function drillNeedsFollowUp(input: DrillOutcomeInput): boolean {
  return drillConcerns(input).length > 0;
}

/** People unaccounted for is the one that is never "medium". */
export function drillActionPriority(reasons: readonly DrillConcernReason[]): 'high' | 'medium' {
  return reasons.includes('people_unaccounted') ? 'high' : 'medium';
}
