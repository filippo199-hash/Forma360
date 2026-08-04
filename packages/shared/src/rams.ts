/**
 * RAMS — Risk Assessment & Method Statement domain helpers (FreeHS
 * module B6). See ADR 0015.
 *
 * Pure data + functions shared by the DB schema, the API router, the web
 * UI, the renderer and any worker:
 *   - the two lifecycle state machines (`canTransitionMethodStatement`
 *     for the reusable *how*, `canTransitionPack` for the issuable
 *     artefact) — the router refuses any move not in these matrices;
 *   - the method-statement content model: an ordered list of steps, each
 *     referencing hazards in the bound risk assessments rather than
 *     restating them, plus the fixed emergency / logistics blocks every
 *     reviewer looks for;
 *   - the issue gate (§6.1 of the spec) — including
 *     {@link unreferencedHighRiskHazards}, the validation that stops a
 *     RAMS being two unrelated documents stapled together;
 *   - the PPE, plant, personnel-role and trade vocabularies;
 *   - the seeded starter templates (`DEFAULT_METHOD_STATEMENT_TEMPLATES`)
 *     that make the library the adoption feature it needs to be;
 *   - the third-party review checklist definition;
 *   - reference formatters (`MS-` / `RAMS-`, 6-digit pad that grows past
 *     999999).
 *
 * Everything here is deterministic and side-effect free so the tRPC
 * layer, client components and the renderer can all import it.
 *
 * Seeded catalogue content (template titles, step text, checklist labels)
 * is tenant DATA, seeded in English and fully editable — the same stance
 * as `DEFAULT_PERMIT_TYPES` and the risk-matrix defaults. UI chrome
 * (statuses, buttons, column headers) is translated via `rams.*` keys.
 */
import { z } from 'zod';
import { bandFor, bandRank, type RiskBandLevel, type RiskMatrixConfig } from './risk-matrix';

// ─── Lifecycles ─────────────────────────────────────────────────────────────

export const METHOD_STATEMENT_STATUSES = ['draft', 'published', 'archived'] as const;
export type MethodStatementStatus = (typeof METHOD_STATEMENT_STATUSES)[number];

/**
 * Method statements mirror the RA module's proven shape. Editing a
 * published method statement creates a new draft version rather than
 * moving the header backwards, so `published → draft` is absent by
 * design; `archived → draft` is the un-archive path.
 *
 * `published → published` is republication — version n+1 of an already
 * published method statement, the same self-transition the pack
 * lifecycle uses for re-issue. It is listed explicitly rather than
 * special-cased in the router.
 */
const METHOD_STATEMENT_TRANSITIONS: Record<
  MethodStatementStatus,
  ReadonlyArray<MethodStatementStatus>
> = {
  draft: ['published', 'archived'],
  published: ['published', 'archived'],
  archived: ['draft', 'published'],
};

export function canTransitionMethodStatement(
  from: MethodStatementStatus,
  to: MethodStatementStatus,
): boolean {
  return METHOD_STATEMENT_TRANSITIONS[from].includes(to);
}

export const RAMS_PACK_STATUSES = [
  'draft',
  'issued',
  'superseded',
  'withdrawn',
  'cancelled',
] as const;
export type RamsPackStatus = (typeof RAMS_PACK_STATUSES)[number];

/**
 * `issued → issued` is not a self-loop in the matrix: re-issue moves the
 * *old version* to superseded while the pack row stays `issued` at
 * version n+1. The transition the router checks on re-issue is
 * `issued → issued`, so it is listed explicitly.
 */
const RAMS_PACK_TRANSITIONS: Record<RamsPackStatus, ReadonlyArray<RamsPackStatus>> = {
  draft: ['issued', 'cancelled'],
  issued: ['issued', 'superseded', 'withdrawn'],
  superseded: [],
  withdrawn: [],
  cancelled: [],
};

export function canTransitionPack(from: RamsPackStatus, to: RamsPackStatus): boolean {
  return RAMS_PACK_TRANSITIONS[from].includes(to);
}

/** Statuses where the pack governs work that may be happening right now. */
export function isLivePackStatus(status: RamsPackStatus): boolean {
  return status === 'issued';
}

// ─── Vocabularies ───────────────────────────────────────────────────────────

/**
 * Shared PPE vocabulary. Multi-select from this list plus free text —
 * the same "presets + extras" stance as the RA module's affected groups.
 */
export const PPE_ITEMS = [
  'safety_helmet',
  'safety_footwear',
  'hi_vis',
  'eye_protection',
  'hearing_protection',
  'gloves',
  'respiratory_protection',
  'fall_arrest_harness',
  'face_shield',
  'coveralls',
  'chemical_apron',
  'welding_ppe',
  'cut_resistant_gloves',
  'knee_pads',
  'life_jacket',
] as const;
export type PpeItem = (typeof PPE_ITEMS)[number];

/**
 * Trade / category vocabulary — drives library grouping and the AI
 * template suggestion. `other` covers tenant-defined work.
 */
export const METHOD_STATEMENT_TRADES = [
  'mechanical',
  'electrical',
  'work_at_height',
  'groundworks',
  'hot_works',
  'confined_space',
  'lifting',
  'maintenance',
  'cleaning',
  'demolition',
  'roofing',
  'other',
] as const;
export type MethodStatementTrade = (typeof METHOD_STATEMENT_TRADES)[number];

/**
 * Personnel roles a step can require. Free-text `roleOther` carries
 * anything outside the list so the vocabulary never blocks authoring.
 */
export const PERSONNEL_ROLES = [
  'supervisor',
  'operative',
  'banksman',
  'appointed_person',
  'first_aider',
  'fire_watch',
  'standby_person',
  'competent_person',
  'authorised_person',
  'other',
] as const;
export type PersonnelRole = (typeof PERSONNEL_ROLES)[number];

/**
 * What a hold point waits for. A hold point is where a method statement
 * stops being a document and becomes a system of work — the briefing UI
 * shows them and the PDF prints them prominently.
 */
export const HOLD_POINT_KINDS = [
  'isolation_proved',
  'permit_issued',
  'inspection_passed',
  'atmosphere_tested',
  'client_approval',
  'supervisor_check',
  'other',
] as const;
export type HoldPointKind = (typeof HOLD_POINT_KINDS)[number];

// ─── Method-statement content ───────────────────────────────────────────────

/** Personnel requirement on one step. */
export const stepPersonnelSchema = z.object({
  role: z.enum(PERSONNEL_ROLES),
  /** Used when `role === 'other'`; ignored otherwise. */
  roleOther: z.string().trim().max(120).default(''),
  count: z.number().int().min(1).max(200),
  competenceNote: z.string().trim().max(500).default(''),
});
export type StepPersonnel = z.infer<typeof stepPersonnelSchema>;

/** Optional stop-and-check on a step. */
export const holdPointSchema = z.object({
  kind: z.enum(HOLD_POINT_KINDS),
  /** What must be true before work continues. */
  description: z.string().trim().min(1).max(500),
  /** Who signs it off — a role name, not a user id (the pack is reusable). */
  responsibleRole: z.string().trim().max(160).default(''),
});
export type HoldPoint = z.infer<typeof holdPointSchema>;

/**
 * A reference to one hazard in a bound risk-assessment version. The
 * method statement NEVER restates the hazard text as the source of
 * truth; `hazardLabel` is a display snapshot so a printed pack stays
 * readable, but the RA version remains authoritative.
 */
export const hazardRefSchema = z.object({
  /** `risk_assessment_versions.id` the hazard belongs to. */
  raVersionId: z.string().length(26),
  /** Index of the hazard inside that version's `content.hazards`. */
  hazardIndex: z.number().int().min(0).max(999),
  /** Display snapshot — never the source of truth. */
  hazardLabel: z.string().trim().max(500).default(''),
});
export type HazardRef = z.infer<typeof hazardRefSchema>;

/** A reference to a COSHH substance used at this step. */
export const substanceRefSchema = z.object({
  substanceId: z.string().length(26),
  substanceName: z.string().trim().max(300).default(''),
});
export type SubstanceRef = z.infer<typeof substanceRefSchema>;

/** Equipment or plant used at a step; may point at an `assets` row. */
export const stepPlantSchema = z.object({
  name: z.string().trim().min(1).max(200),
  assetId: z.string().length(26).nullable().default(null),
  /** Certificate / inspection note — "LOLER cert in date". */
  note: z.string().trim().max(300).default(''),
});
export type StepPlant = z.infer<typeof stepPlantSchema>;

export const MAX_METHOD_STATEMENT_STEPS = 100;

/** One sequenced step of the safe system of work. */
export const methodStatementStepSchema = z.object({
  id: z.string().min(1).max(40),
  /** 1..n, dense — enforced across the array by the content schema. */
  sequence: z.number().int().min(1).max(MAX_METHOD_STATEMENT_STEPS),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).default(''),
  hazardRefs: z.array(hazardRefSchema).max(40).default([]),
  controlNotes: z.string().trim().max(2000).default(''),
  plant: z.array(stepPlantSchema).max(30).default([]),
  substanceRefs: z.array(substanceRefSchema).max(30).default([]),
  ppe: z.array(z.enum(PPE_ITEMS)).max(PPE_ITEMS.length).default([]),
  ppeOther: z.string().trim().max(300).default(''),
  personnel: z.array(stepPersonnelSchema).max(20).default([]),
  holdPoint: holdPointSchema.nullable().default(null),
  environmentalNotes: z.string().trim().max(1000).default(''),
});
export type MethodStatementStep = z.infer<typeof methodStatementStepSchema>;

/**
 * The fixed blocks every client and every reviewer looks for. Structured
 * fields, not free prose, so the review checklist can assert presence.
 */
export const emergencyBlockSchema = z.object({
  /** First-aid arrangements — who, where, what equipment. */
  firstAid: z.string().trim().max(2000).default(''),
  /** Emergency procedure: raise the alarm, muster, contact. */
  emergencyProcedure: z.string().trim().max(2000).default(''),
  /** Rescue plan — reuses the permits vocabulary where a type demands one. */
  rescuePlan: z.string().trim().max(2000).default(''),
  /** Nearest A&E / emergency services notes. */
  nearestHospital: z.string().trim().max(500).default(''),
  emergencyContacts: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        role: z.string().trim().max(160).default(''),
        phone: z.string().trim().max(60).default(''),
      }),
    )
    .max(20)
    .default([]),
});
export type EmergencyBlock = z.infer<typeof emergencyBlockSchema>;

export const logisticsBlockSchema = z.object({
  /** Welfare provision — toilets, water, rest area. */
  welfare: z.string().trim().max(2000).default(''),
  /** Waste and environmental controls — spill, noise, dust. */
  environmental: z.string().trim().max(2000).default(''),
  /** Site-specific access and egress. */
  accessEgress: z.string().trim().max(2000).default(''),
  /** Permits the work is expected to need, as free text guidance. */
  permitsRequired: z.string().trim().max(1000).default(''),
  /** Training / competence expectations for the crew as a whole. */
  competence: z.string().trim().max(2000).default(''),
});
export type LogisticsBlock = z.infer<typeof logisticsBlockSchema>;

/** Schema version stamped into every persisted content blob. */
export const RAMS_CONTENT_SCHEMA_VERSION = 1;

/**
 * The full method-statement content blob. Persisted as jsonb on
 * `method_statement_versions.content` and snapshotted into
 * `rams_pack_versions.content` at issue.
 */
export const methodStatementContentSchema = z
  .object({
    schemaVersion: z.literal(RAMS_CONTENT_SCHEMA_VERSION).default(RAMS_CONTENT_SCHEMA_VERSION),
    /** Scope of works — what the job actually is, in one paragraph. */
    scopeOfWorks: z.string().trim().max(4000).default(''),
    /** Sequence of operations. */
    steps: z.array(methodStatementStepSchema).max(MAX_METHOD_STATEMENT_STEPS).default([]),
    emergency: emergencyBlockSchema.default({}),
    logistics: logisticsBlockSchema.default({}),
  })
  .superRefine((content, ctx) => {
    // Dense, ordered 1..n sequencing — the same discipline the template
    // content schema applies to `slotIndex`. Reordering in the UI
    // renumbers; a gap means a client bug, not a valid document.
    content.steps.forEach((step, index) => {
      if (step.sequence !== index + 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', index, 'sequence'],
          message: `Step sequence must be dense and 1-based; expected ${index + 1}`,
        });
      }
    });
    const ids = new Set<string>();
    content.steps.forEach((step, index) => {
      if (ids.has(step.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', index, 'id'],
          message: 'Duplicate step id',
        });
      }
      ids.add(step.id);
    });
  });

export type MethodStatementContent = z.infer<typeof methodStatementContentSchema>;

/**
 * Parse an untrusted content blob. Throws a `ZodError` on failure — every
 * boundary that persists or reads content runs through here (ground
 * rule 2).
 */
export function parseMethodStatementContent(value: unknown): MethodStatementContent {
  return methodStatementContentSchema.parse(value);
}

/** An empty but valid content blob — what a blank method statement starts as. */
export function emptyMethodStatementContent(): MethodStatementContent {
  return methodStatementContentSchema.parse({});
}

/**
 * Renumber steps densely from 1 after an insert / delete / reorder. The
 * builder calls this on every mutation so the content schema's density
 * rule can never be violated by a UI action.
 */
export function resequenceSteps(steps: ReadonlyArray<MethodStatementStep>): MethodStatementStep[] {
  return steps.map((step, index) => ({ ...step, sequence: index + 1 }));
}

// ─── Bound risk assessments (the issue gate's input) ─────────────────────────

/**
 * The shape the issue gate needs from a bound RA version. Deliberately
 * structural rather than importing the DB type — this file is pure and
 * the renderer, the router and the web builder all supply it from
 * different sources.
 */
export interface BoundRaHazard {
  /** Index inside the version's `content.hazards`. */
  index: number;
  hazard: string;
  residualLikelihood: number | null;
  residualSeverity: number | null;
}

export interface BoundRaVersion {
  raVersionId: string;
  assessmentId: string;
  referenceNumber: string | null;
  title: string;
  versionNumber: number;
  matrix: RiskMatrixConfig;
  hazards: ReadonlyArray<BoundRaHazard>;
}

/** Default residual band at or above which a hazard must be addressed by a step. */
export const DEFAULT_HIGH_RISK_THRESHOLD: RiskBandLevel = 'high';

export interface UnreferencedHazard {
  raVersionId: string;
  hazardIndex: number;
  hazard: string;
  assessmentTitle: string;
  band: RiskBandLevel;
}

/**
 * The headline validation (§6.1). Every bound hazard whose residual band
 * is at or above `threshold` must be referenced by at least one step —
 * i.e. the method actually addresses the biggest risks. Returns the
 * hazards that are not, in bound order, so the UI can deep-link each one.
 *
 * Hazards that are not yet scored are not "high risk" and never block
 * issue; the RA module's own publish gate governs scoring completeness.
 */
export function unreferencedHighRiskHazards(
  content: Pick<MethodStatementContent, 'steps'>,
  raVersions: ReadonlyArray<BoundRaVersion>,
  threshold: RiskBandLevel = DEFAULT_HIGH_RISK_THRESHOLD,
): UnreferencedHazard[] {
  const referenced = new Set<string>();
  for (const step of content.steps) {
    for (const ref of step.hazardRefs) {
      referenced.add(`${ref.raVersionId}:${ref.hazardIndex}`);
    }
  }

  const out: UnreferencedHazard[] = [];
  for (const version of raVersions) {
    for (const hazard of version.hazards) {
      const band = bandFor(hazard.residualLikelihood, hazard.residualSeverity, version.matrix);
      if (band === 'none') continue;
      if (bandRank(band) < bandRank(threshold)) continue;
      if (referenced.has(`${version.raVersionId}:${hazard.index}`)) continue;
      out.push({
        raVersionId: version.raVersionId,
        hazardIndex: hazard.index,
        hazard: hazard.hazard,
        assessmentTitle: version.title,
        // `band` is at or above `threshold`, so it is a level, not 'none'.
        band: band as RiskBandLevel,
      });
    }
  }
  return out;
}

// ─── The issue gate ─────────────────────────────────────────────────────────

/**
 * Every reason a pack can be refused issue. Slugs follow the platform's
 * 1:1 i18n contract — each has exactly one `rams.errors.*` message and
 * no message is an orphan (the incidents module's discipline).
 */
export const RAMS_ISSUE_GATE_ERRORS = [
  'no-steps',
  'step-missing-title',
  'step-missing-description',
  'no-risk-assessment',
  'risk-assessment-not-published',
  'emergency-block-incomplete',
  'high-risk-hazard-unreferenced',
  'attestation-not-confirmed',
] as const;
export type RamsIssueGateError = (typeof RAMS_ISSUE_GATE_ERRORS)[number];

export interface IssueGateInput {
  content: MethodStatementContent;
  raVersions: ReadonlyArray<BoundRaVersion>;
  /** False when any bound RA version is a draft / not published. */
  allRaVersionsPublished: boolean;
  /** The caller actively confirmed the author attestation. */
  attestationConfirmed: boolean;
  threshold?: RiskBandLevel;
}

export interface IssueGateResult {
  errors: RamsIssueGateError[];
  /** Populated when `high-risk-hazard-unreferenced` fires — for the UI. */
  unreferenced: UnreferencedHazard[];
}

/**
 * The emergency block counts as complete when the arrangements a
 * reviewer actually looks for are present: first aid AND the emergency
 * procedure. Rescue plan, hospital and contacts are strongly encouraged
 * but not every job needs a rescue plan, so they do not block.
 */
export function emergencyBlockComplete(block: EmergencyBlock): boolean {
  return block.firstAid.trim().length > 0 && block.emergencyProcedure.trim().length > 0;
}

/**
 * Evaluate the whole issue gate. Returns every failure at once (not
 * first-fail) so the builder can show a single actionable checklist
 * rather than making the author play whack-a-mole.
 */
export function evaluateIssueGate(input: IssueGateInput): IssueGateResult {
  const errors: RamsIssueGateError[] = [];
  const { content, raVersions } = input;

  if (content.steps.length === 0) errors.push('no-steps');
  if (content.steps.some((s) => s.title.trim().length === 0)) errors.push('step-missing-title');
  if (content.steps.some((s) => s.description.trim().length === 0)) {
    errors.push('step-missing-description');
  }

  // Order matters: a pack that bound an assessment which has never been
  // published resolves to zero usable versions, so the unpublished case
  // must be reported BEFORE the empty case — otherwise the author is
  // told "bind a risk assessment" when they already did.
  if (!input.allRaVersionsPublished) errors.push('risk-assessment-not-published');
  else if (raVersions.length === 0) errors.push('no-risk-assessment');

  if (!emergencyBlockComplete(content.emergency)) errors.push('emergency-block-incomplete');

  const unreferenced = unreferencedHighRiskHazards(
    content,
    raVersions,
    input.threshold ?? DEFAULT_HIGH_RISK_THRESHOLD,
  );
  if (unreferenced.length > 0) errors.push('high-risk-hazard-unreferenced');

  if (!input.attestationConfirmed) errors.push('attestation-not-confirmed');

  return { errors, unreferenced };
}

// ─── Briefing ───────────────────────────────────────────────────────────────

/** How a briefee is identified — an account holder or a named person. */
export const BRIEFEE_KINDS = ['user', 'named_person'] as const;
export type BriefeeKind = (typeof BRIEFEE_KINDS)[number];

/** What the person is on this job — mirrors the incidents person model. */
export const BRIEFEE_CATEGORIES = [
  'employee',
  'subcontractor',
  'agency',
  'visitor',
  'client_representative',
  'other',
] as const;
export type BriefeeCategory = (typeof BRIEFEE_CATEGORIES)[number];

// ─── Client acceptance ──────────────────────────────────────────────────────

export const CLIENT_DECISIONS = ['pending', 'accepted', 'changes_requested'] as const;
export type ClientDecision = (typeof CLIENT_DECISIONS)[number];

// ─── Third-party review (§9) ────────────────────────────────────────────────

export const REVIEW_OUTCOMES = [
  'pending',
  'accepted',
  'accepted_with_conditions',
  'rejected',
] as const;
export type RamsReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

export const REVIEW_ITEM_VERDICTS = ['pass', 'fail', 'na'] as const;
export type ReviewItemVerdict = (typeof REVIEW_ITEM_VERDICTS)[number];

/**
 * The reviewer's checklist. Ids are stable (they key the i18n labels and
 * survive in stored review rows); the English label is the fallback the
 * PDF prints when a locale has no override.
 */
export interface ReviewChecklistItemDef {
  readonly id: string;
  readonly label: string;
}

export const RAMS_REVIEW_CHECKLIST: ReadonlyArray<ReviewChecklistItemDef> = [
  { id: 'scope_matches', label: 'Scope of works matches the work we have instructed' },
  { id: 'hazards_credible', label: 'Hazards identified and controls credible for the work' },
  { id: 'sequence_holdpoints', label: 'Sequence includes isolation / permit hold points' },
  { id: 'emergency_present', label: 'Emergency and first-aid arrangements present' },
  { id: 'competence_evidence', label: 'Competence and training evidence attached' },
  { id: 'coshh_covered', label: 'COSHH / substances covered where used' },
  { id: 'plant_certified', label: 'Plant and equipment certification in date' },
  { id: 'insurance_current', label: 'Insurance current and adequate for the work' },
];

export const reviewChecklistEntrySchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().trim().min(1).max(300),
  verdict: z.enum(REVIEW_ITEM_VERDICTS),
  comment: z.string().trim().max(1000).default(''),
});
export type ReviewChecklistEntry = z.infer<typeof reviewChecklistEntrySchema>;

/** Copy the checklist definition onto a new review, all unanswered. */
export function snapshotReviewChecklist(): ReviewChecklistEntry[] {
  return RAMS_REVIEW_CHECKLIST.map((item) => ({
    id: item.id,
    label: item.label,
    verdict: 'na' as const,
    comment: '',
  }));
}

/**
 * A review may only be accepted when nothing on the checklist failed.
 * `accepted_with_conditions` is the outlet for "fails, but we can live
 * with it if they do X" — it requires conditions text (router-enforced).
 */
export function reviewHasFailures(entries: ReadonlyArray<ReviewChecklistEntry>): boolean {
  return entries.some((e) => e.verdict === 'fail');
}

/**
 * Is an accepted third-party review still valid at `now`? Expiry is what
 * stops a stale acceptance satisfying a permit requirement (RS-E13).
 */
export function reviewAcceptanceValid(
  review: {
    outcome: RamsReviewOutcome;
    validFrom: Date | null;
    validTo: Date | null;
  },
  now: Date,
): boolean {
  if (review.outcome !== 'accepted' && review.outcome !== 'accepted_with_conditions') return false;
  if (review.validFrom !== null && review.validFrom.getTime() > now.getTime()) return false;
  if (review.validTo !== null && review.validTo.getTime() < now.getTime()) return false;
  return true;
}

// ─── Author attestation ─────────────────────────────────────────────────────

/**
 * The declaration the author actively confirms at issue, shown in full
 * before signing (the RA module's M-2 lesson: the attestation appears on
 * EVERY issue, not only when something else triggered a dialog). The
 * router snapshots this onto the version row, so the printed record
 * carries the exact wording that was agreed to.
 *
 * Deliberately untranslated: it is a legal declaration a named person
 * signs, stored verbatim and printed on the PDF, so it must be the same
 * text everywhere rather than whatever locale the author was using.
 */
export const RAMS_AUTHOR_ATTESTATION =
  'I confirm that I have prepared or reviewed this risk assessment and method statement, ' +
  'that it is suitable and sufficient for the work described, that the sequence of work and ' +
  'the control measures are those that will actually be followed, and that it will be briefed ' +
  'to everyone carrying out the work before they start.';

// ─── Reference formatters ───────────────────────────────────────────────────

export const METHOD_STATEMENT_REFERENCE_PREFIX = 'MS-';
export const RAMS_PACK_REFERENCE_PREFIX = 'RAMS-';

/**
 * `MS-` + 6-digit zero-pad. `padStart` never truncates, so the series
 * simply grows to seven digits past 999999 rather than colliding
 * (RS-E16).
 */
export function formatMethodStatementReference(value: number): string {
  return `${METHOD_STATEMENT_REFERENCE_PREFIX}${String(value).padStart(6, '0')}`;
}

/** `RAMS-` + 6-digit zero-pad, same continuity guarantee. */
export function formatRamsPackReference(value: number): string {
  return `${RAMS_PACK_REFERENCE_PREFIX}${String(value).padStart(6, '0')}`;
}

// ─── Seeded starter templates (§5 — the adoption feature) ───────────────────

export interface DefaultMethodStatementTemplate {
  readonly title: string;
  readonly trade: MethodStatementTrade;
  readonly scopeOfWorks: string;
  readonly steps: ReadonlyArray<{
    readonly title: string;
    readonly description: string;
    readonly ppe: ReadonlyArray<PpeItem>;
    readonly holdPoint?: { readonly kind: HoldPointKind; readonly description: string };
  }>;
  readonly emergency: Partial<EmergencyBlock>;
  readonly logistics: Partial<LogisticsBlock>;
}

const BASE_PPE: ReadonlyArray<PpeItem> = ['safety_helmet', 'safety_footwear', 'hi_vis'];

/**
 * Eight skeletons for common trades — six to ten steps each, hold points
 * marked. Seeded once per tenant (idempotent) and fully editable: these
 * are sensible UK practice defaults, not statutory text. A contractor
 * does the same twelve jobs repeatedly; if every pack started blank they
 * would keep using Word.
 */
export const DEFAULT_METHOD_STATEMENT_TEMPLATES: ReadonlyArray<DefaultMethodStatementTemplate> = [
  {
    title: 'Plant room — mechanical works',
    trade: 'mechanical',
    scopeOfWorks:
      'Planned mechanical maintenance within an occupied building plant room, including filter changes, belt and coupling checks and minor component replacement.',
    steps: [
      {
        title: 'Arrive, sign in and confirm permits',
        description:
          'Report to the site contact, sign in, confirm the work area and check that any required permits to work have been issued before entering the plant room.',
        ppe: BASE_PPE,
      },
      {
        title: 'Establish the work area',
        description:
          'Set out barriers and signage at the plant room door. Confirm safe access and egress and that the escape route from the plant room remains clear throughout.',
        ppe: BASE_PPE,
      },
      {
        title: 'Isolate and prove dead',
        description:
          'Isolate the plant electrically and mechanically at the local isolator. Lock off, apply tags, and prove dead at the point of work with a proving unit before and after testing.',
        ppe: [...BASE_PPE, 'gloves'],
        holdPoint: {
          kind: 'isolation_proved',
          description:
            'Work does not start until the isolation has been proved dead at the point of work and the lock-off is in place.',
        },
      },
      {
        title: 'Carry out the mechanical work',
        description:
          'Complete the planned work using the correct tools. Keep the area tidy, do not leave components where they can fall, and use mechanical aids for anything above safe manual-handling limits.',
        ppe: [...BASE_PPE, 'gloves', 'eye_protection'],
      },
      {
        title: 'Clean down and remove waste',
        description:
          'Clean the plant and the surrounding area. Bag and remove filters and waste to the agreed waste route. Do not leave waste in the plant room.',
        ppe: [...BASE_PPE, 'gloves', 'respiratory_protection'],
      },
      {
        title: 'De-isolate and functionally test',
        description:
          'Remove locks and tags in reverse order, restore supplies and run the plant. Confirm normal operation, correct rotation and that no alarms are present.',
        ppe: BASE_PPE,
        holdPoint: {
          kind: 'supervisor_check',
          description:
            'Supervisor confirms plant is running correctly before the area is handed back.',
        },
      },
      {
        title: 'Hand back and sign out',
        description:
          'Remove barriers and signage, hand the area back to the site contact, complete the paperwork and sign out.',
        ppe: BASE_PPE,
      },
    ],
    emergency: {
      firstAid:
        'Nominated first aider on the crew carries a first-aid kit. The site first-aid point and site first aiders are identified at induction.',
      emergencyProcedure:
        'On discovering an emergency, stop work, make the area safe if it is safe to do so, raise the alarm with the site contact and evacuate to the site muster point. Call 999 for serious injury and send someone to meet the ambulance.',
    },
    logistics: {
      welfare: 'Site welfare facilities used by arrangement with the site contact.',
      environmental:
        'Waste removed under the site waste arrangements. Spill kit carried for oils and glycol. Noise kept to normal working hours.',
      accessEgress:
        'Access via the agreed route. The plant room escape route is kept clear at all times.',
    },
  },
  {
    title: 'Electrical installation and testing',
    trade: 'electrical',
    scopeOfWorks:
      'Installation, alteration and testing of fixed electrical installations in accordance with BS 7671, including final circuits and distribution boards.',
    steps: [
      {
        title: 'Arrive, sign in and confirm scope',
        description:
          'Report to the site contact, confirm the circuits and boards in scope, and confirm which supplies may be interrupted and when.',
        ppe: BASE_PPE,
      },
      {
        title: 'Identify the circuits and agree the isolation',
        description:
          'Identify the circuits to be worked on from drawings and on-site verification. Agree the isolation window with the site contact and warn affected occupants.',
        ppe: BASE_PPE,
      },
      {
        title: 'Isolate, lock off and prove dead',
        description:
          'Safely isolate at the distribution board, lock off with a personal lock and apply caution tags. Prove dead at the point of work using an approved voltage indicator proved before and after use on a known source.',
        ppe: [...BASE_PPE, 'gloves', 'eye_protection'],
        holdPoint: {
          kind: 'isolation_proved',
          description:
            'No conductor is touched until it has been proved dead at the point of work and the lock-off is in place.',
        },
      },
      {
        title: 'Install or alter the wiring',
        description:
          'Carry out the installation work to BS 7671. Support cables correctly, maintain segregation, and make off terminations to the correct torque.',
        ppe: [...BASE_PPE, 'gloves'],
      },
      {
        title: 'Inspect and test',
        description:
          'Carry out dead testing (continuity, insulation resistance, polarity) before energising, then live testing (earth fault loop impedance, RCD operation) with the appropriate instruments and safe working practices.',
        ppe: [...BASE_PPE, 'eye_protection', 'gloves'],
        holdPoint: {
          kind: 'inspection_passed',
          description:
            'Dead tests must pass before the installation is energised. A failed test stops the work.',
        },
      },
      {
        title: 'Energise and confirm operation',
        description:
          'Remove locks and tags, restore the supply, and confirm correct operation of the circuits and any connected equipment.',
        ppe: BASE_PPE,
      },
      {
        title: 'Certificate, label and hand back',
        description:
          'Complete the electrical installation certificate or minor works certificate, update the board schedule and labelling, and hand back to the site contact.',
        ppe: BASE_PPE,
      },
    ],
    emergency: {
      firstAid:
        'Crew first aider trained in resuscitation. First-aid kit on the van. Site first-aid arrangements confirmed at induction.',
      emergencyProcedure:
        'In the event of electric shock do not touch the casualty until the supply is isolated. Isolate at the board, call 999, start resuscitation if trained and safe to do so, and notify the site contact.',
    },
    logistics: {
      welfare: 'Site welfare facilities used by arrangement with the site contact.',
      environmental: 'Cable offcuts and packaging removed and recycled under the site waste route.',
      accessEgress: 'Access to boards kept clear; working space to BS 7671 maintained.',
      competence:
        'All operatives hold current recognised electrical qualifications and an ECS or equivalent card appropriate to the work.',
    },
  },
  {
    title: 'Working at height / roof access',
    trade: 'work_at_height',
    scopeOfWorks:
      'Access to roof areas and work at height using appropriate access equipment, including inspection, maintenance and minor repair.',
    steps: [
      {
        title: 'Arrive, sign in and check conditions',
        description:
          'Report to the site contact and check the weather forecast. Work at height does not proceed in high winds, ice, or storm conditions.',
        ppe: BASE_PPE,
      },
      {
        title: 'Inspect the access equipment',
        description:
          'Visually inspect ladders, towers, MEWPs and harnesses before use. Confirm inspection records and certificates are in date. Defective equipment is quarantined and not used.',
        ppe: BASE_PPE,
        holdPoint: {
          kind: 'inspection_passed',
          description: 'Access equipment pre-use inspection must pass before anyone goes up.',
        },
      },
      {
        title: 'Establish the exclusion zone',
        description:
          'Barrier off the area beneath the work at height and put out signage. Nobody works or passes beneath the work area while it is live.',
        ppe: BASE_PPE,
      },
      {
        title: 'Set up the access equipment',
        description:
          'Erect towers to the manufacturer instructions with a trained operative, or position the MEWP on assessed ground. Confirm stability, outriggers and edge protection before use.',
        ppe: BASE_PPE,
      },
      {
        title: 'Access the work area and attach fall protection',
        description:
          'Access the work position. Where collective protection is not available, clip the harness to a suitable anchor at all times. Maintain three points of contact on ladders.',
        ppe: [...BASE_PPE, 'fall_arrest_harness'],
        holdPoint: {
          kind: 'supervisor_check',
          description:
            'Supervisor confirms fall protection is in place and anchors are suitable before work starts at height.',
        },
      },
      {
        title: 'Carry out the work',
        description:
          'Complete the planned work. Tools are tethered or kept in a bag. Nothing is thrown or dropped from height. Fragile surfaces are identified and never walked on.',
        ppe: [...BASE_PPE, 'fall_arrest_harness', 'gloves'],
      },
      {
        title: 'Descend, dismantle and clear the area',
        description:
          'Lower tools and materials safely, descend, dismantle the access equipment and remove the exclusion zone. Clear all waste from the roof.',
        ppe: BASE_PPE,
      },
      {
        title: 'Hand back and sign out',
        description: 'Hand the area back to the site contact, complete paperwork and sign out.',
        ppe: BASE_PPE,
      },
    ],
    emergency: {
      firstAid: 'Crew first aider on site with a first-aid kit at ground level.',
      emergencyProcedure:
        'On an incident at height, do not attempt an unplanned rescue. Raise the alarm, implement the rescue plan, and call 999 stating that a person is at height or suspended.',
      rescuePlan:
        'A rescue plan is in place for suspension in a harness: the MEWP is used to reach the casualty, or the emergency services are called immediately. Suspension trauma is treated as a medical emergency and the casualty is not left suspended.',
    },
    logistics: {
      welfare: 'Site welfare facilities used by arrangement with the site contact.',
      environmental: 'Debris netting used where required. All waste lowered, never dropped.',
      accessEgress:
        'Roof access via the agreed hatch or stair. Access kept locked when unattended.',
      competence:
        'Operatives hold current work-at-height, tower (PASMA) or MEWP (IPAF) training appropriate to the equipment used.',
    },
  },
  {
    title: 'Groundworks and excavation',
    trade: 'groundworks',
    scopeOfWorks:
      'Excavation for drainage, foundations or services, including service location, support of excavation sides and reinstatement.',
    steps: [
      {
        title: 'Arrive, sign in and confirm the dig',
        description:
          'Report to the site contact and confirm the location, depth and extent of the excavation against the drawings.',
        ppe: BASE_PPE,
      },
      {
        title: 'Locate and mark underground services',
        description:
          'Review service drawings, scan the area with a CAT and Genny, and mark all detected services on the ground. Hand-dig trial holes to positively identify services before machine excavation.',
        ppe: BASE_PPE,
        holdPoint: {
          kind: 'supervisor_check',
          description:
            'No machine excavation begins until services have been located, marked and positively identified by hand-dug trial holes.',
        },
      },
      {
        title: 'Set up the exclusion zone',
        description:
          'Barrier the excavation area and the machine slew zone. Pedestrians are routed away from the works. A banksman controls all plant movements.',
        ppe: BASE_PPE,
      },
      {
        title: 'Excavate',
        description:
          'Excavate to the required depth. Spoil is placed at least one metre from the edge. The excavation is battered, stepped or supported according to the ground conditions and depth.',
        ppe: [...BASE_PPE, 'gloves'],
      },
      {
        title: 'Support the excavation and provide access',
        description:
          'Install trench boxes or shoring where the depth or ground requires it. Provide a ladder for safe access and egress extending one metre above the edge.',
        ppe: [...BASE_PPE, 'gloves'],
        holdPoint: {
          kind: 'inspection_passed',
          description:
            'A competent person inspects the excavation and its supports before anyone enters, at the start of every shift, and after any event that may have affected stability.',
        },
      },
      {
        title: 'Carry out the work in the excavation',
        description:
          'Complete the planned work. Nobody works in an unsupported excavation over 1.2 m. Atmosphere is tested where there is any risk of gas accumulation.',
        ppe: [...BASE_PPE, 'gloves'],
      },
      {
        title: 'Backfill and reinstate',
        description:
          'Backfill in compacted layers, remove supports progressively from a safe position, and reinstate the surface to the agreed specification.',
        ppe: [...BASE_PPE, 'gloves'],
      },
      {
        title: 'Clear the area and hand back',
        description:
          'Remove barriers, clean the area, remove waste and hand back to the site contact.',
        ppe: BASE_PPE,
      },
    ],
    emergency: {
      firstAid: 'Crew first aider on site with a first-aid kit.',
      emergencyProcedure:
        'On a collapse or a person trapped, do not enter the excavation. Raise the alarm, call 999 immediately and state that a person is trapped in an excavation. Keep the casualty talking from a safe position.',
      rescuePlan:
        'Rescue from an excavation is carried out by the emergency services. No unplanned entry is made into a collapsed or unsupported excavation.',
    },
    logistics: {
      welfare: 'Site welfare facilities used by arrangement with the principal contractor.',
      environmental:
        'Arisings stockpiled and removed under a waste transfer note. Silt runoff controlled. Dust damped down in dry conditions.',
      accessEgress:
        'Ladder access into the excavation at no more than 25 m intervals, secured and extending 1 m above the edge.',
    },
  },
  {
    title: 'Hot works — welding, cutting and brazing',
    trade: 'hot_works',
    scopeOfWorks:
      'Hot works including welding, flame cutting, grinding and brazing carried out under a hot work permit.',
    steps: [
      {
        title: 'Obtain the hot work permit',
        description:
          'Obtain a hot work permit from the site contact before any hot work begins. Confirm the permit conditions, the validity window and the fire watch requirement.',
        ppe: BASE_PPE,
        holdPoint: {
          kind: 'permit_issued',
          description: 'No hot work starts until the hot work permit has been issued and accepted.',
        },
      },
      {
        title: 'Prepare and clear the work area',
        description:
          'Remove all combustible materials within 10 metres or protect them with fire blankets and screens. Cover or seal openings, drains and ducts through which sparks could travel.',
        ppe: BASE_PPE,
      },
      {
        title: 'Test the atmosphere where required',
        description:
          'Where there is any possibility of a flammable atmosphere, test with a calibrated gas detector and confirm the reading is within the permit limits before starting.',
        ppe: BASE_PPE,
        holdPoint: {
          kind: 'atmosphere_tested',
          description:
            'Where gas testing is required by the permit, the reading must be within limits immediately before hot work starts.',
        },
      },
      {
        title: 'Set out fire-fighting equipment and the fire watch',
        description:
          'Place suitable extinguishers at the point of work. Brief the fire watch, who remains present throughout the work.',
        ppe: BASE_PPE,
      },
      {
        title: 'Inspect the equipment',
        description:
          'Inspect welding sets, leads, regulators, flashback arrestors and hoses before use. Defective equipment is not used. Gas cylinders are secured upright.',
        ppe: [...BASE_PPE, 'welding_ppe'],
      },
      {
        title: 'Carry out the hot work',
        description:
          'Carry out the work using screens to protect others from arc flash. Keep leads clear of walkways. Ventilate the area or use local exhaust to control fume.',
        ppe: [...BASE_PPE, 'welding_ppe', 'face_shield', 'respiratory_protection'],
      },
      {
        title: 'Post-work fire watch',
        description:
          'Maintain the fire watch for at least 60 minutes after the last hot work, checking the work area and adjacent spaces for smouldering.',
        ppe: BASE_PPE,
        holdPoint: {
          kind: 'supervisor_check',
          description:
            'The permit is not closed until the post-work fire watch is complete and the area confirmed cool and safe.',
        },
      },
      {
        title: 'Close the permit and hand back',
        description:
          'Isolate gas at the cylinder, make the area safe, close the hot work permit with the issuer and hand back the area.',
        ppe: BASE_PPE,
      },
    ],
    emergency: {
      firstAid:
        'Crew first aider on site. Burns are cooled with running water for at least 20 minutes. Eye injuries from arc flash receive medical attention.',
      emergencyProcedure:
        'On discovering a fire, raise the alarm, attack only if it is small and safe to do so with the extinguisher provided, evacuate to the muster point and call 999.',
    },
    logistics: {
      welfare: 'Site welfare facilities used by arrangement with the site contact.',
      environmental:
        'Fume controlled at source. Gas cylinders returned to a secure external store at the end of each shift.',
      permitsRequired: 'Hot work permit required. Confined-space permit if applicable.',
      competence:
        'Operatives hold current welding / cutting competence appropriate to the process.',
    },
  },
  {
    title: 'Confined-space entry',
    trade: 'confined_space',
    scopeOfWorks:
      'Entry into a confined space for inspection, cleaning or maintenance, carried out under a confined-space entry permit with a trained standby person and rescue arrangements.',
    steps: [
      {
        title: 'Confirm entry is necessary',
        description:
          'Confirm the work cannot reasonably be done without entry. Where it can be done from outside the space, it is.',
        ppe: BASE_PPE,
      },
      {
        title: 'Obtain the confined-space entry permit',
        description:
          'Obtain the entry permit from the authorised person. Confirm the space, the hazards, the validity window and the rescue arrangements.',
        ppe: BASE_PPE,
        holdPoint: {
          kind: 'permit_issued',
          description: 'No entry is made until the confined-space entry permit has been issued.',
        },
      },
      {
        title: 'Isolate and prove the isolations',
        description:
          'Isolate all mechanical, process and electrical energy sources into the space. Lock off, tag, and prove the isolations. Blank or disconnect process lines where required.',
        ppe: [...BASE_PPE, 'gloves'],
        holdPoint: {
          kind: 'isolation_proved',
          description: 'All isolations are proved before the space is opened.',
        },
      },
      {
        title: 'Ventilate and test the atmosphere',
        description:
          'Ventilate the space. Test the atmosphere for oxygen, flammables and toxics with a calibrated detector, from the top down, before entry. Continue monitoring throughout the entry.',
        ppe: [...BASE_PPE, 'gloves'],
        holdPoint: {
          kind: 'atmosphere_tested',
          description:
            'Entry does not begin until all gas readings are within the permit limits, and the entry stops immediately if any alarm sounds.',
        },
      },
      {
        title: 'Set up the standby person, communications and rescue equipment',
        description:
          'Post the trained standby person at the entry point with the rescue equipment, tripod and winch rigged and the means to summon help. Establish and test communications with the entrants.',
        ppe: BASE_PPE,
      },
      {
        title: 'Enter and log entry',
        description:
          'Entrants sign the entry log with the time of entry, wear the rescue harness attached to the retrieval line and carry a personal gas monitor.',
        ppe: [...BASE_PPE, 'fall_arrest_harness', 'gloves'],
      },
      {
        title: 'Carry out the work',
        description:
          'Complete the planned work, maintaining communication with the standby person at agreed intervals. Evacuate immediately on any alarm, loss of communication or change in conditions.',
        ppe: [...BASE_PPE, 'fall_arrest_harness', 'gloves', 'respiratory_protection'],
      },
      {
        title: 'Exit, log out and account for everyone',
        description:
          'Exit the space, sign out on the entry log and confirm that everyone who entered has come out before the space is closed.',
        ppe: BASE_PPE,
        holdPoint: {
          kind: 'supervisor_check',
          description:
            'The space is not closed and the permit is not returned until every entrant is accounted for on the entry log.',
        },
      },
      {
        title: 'De-isolate, close the permit and hand back',
        description:
          'Remove rescue equipment, de-isolate in the agreed order, close the permit with the authorised person and hand back the area.',
        ppe: BASE_PPE,
      },
    ],
    emergency: {
      firstAid:
        'Crew first aider at the entry point. Oxygen resuscitation available where provided.',
      emergencyProcedure:
        'On an alarm, all entrants evacuate immediately. The standby person never enters the space. Raise the alarm, call 999 stating a confined-space rescue is required, and attempt non-entry retrieval using the tripod and winch.',
      rescuePlan:
        'Non-entry rescue by tripod and retrieval line is the primary means. Entry rescue is carried out only by the emergency services or a dedicated rescue team with breathing apparatus. The standby person does not enter under any circumstances.',
    },
    logistics: {
      welfare: 'Site welfare facilities used by arrangement with the site contact.',
      environmental: 'Arisings and washings collected and disposed of under the site waste route.',
      permitsRequired: 'Confined-space entry permit. Hot work permit if applicable.',
      competence:
        'All entrants and the standby person hold current confined-space training appropriate to the classification of the space.',
    },
  },
  {
    title: 'Lifting operation',
    trade: 'lifting',
    scopeOfWorks:
      'Planned lifting operation using a crane, hoist or lifting accessory, carried out under a lift plan supervised by an appointed person.',
    steps: [
      {
        title: 'Confirm the lift plan',
        description:
          'Confirm the lift plan for the load, the configuration, the ground conditions and the lift radius. The appointed person briefs everyone involved.',
        ppe: BASE_PPE,
        holdPoint: {
          kind: 'supervisor_check',
          description: 'The appointed person confirms the lift plan before the lift is set up.',
        },
      },
      {
        title: 'Check the equipment and certificates',
        description:
          'Check the crane, slings, shackles and lifting accessories for damage and confirm that thorough examination certificates are in date and match the equipment on site.',
        ppe: [...BASE_PPE, 'gloves'],
        holdPoint: {
          kind: 'inspection_passed',
          description:
            'Any equipment without a current certificate or showing damage is quarantined and not used.',
        },
      },
      {
        title: 'Assess and prepare the ground',
        description:
          'Assess the ground for the outrigger loads. Position mats or spreader plates. Confirm no voids, drains or services beneath the standing position.',
        ppe: BASE_PPE,
      },
      {
        title: 'Set up the exclusion zone',
        description:
          'Barrier the lift area including the full slew radius and the load path. Nobody stands or passes beneath a suspended load.',
        ppe: BASE_PPE,
      },
      {
        title: 'Rig the load',
        description:
          'Rig the load with the correct accessories for the weight and centre of gravity. Attach tag lines. The slinger confirms the rigging before the load is lifted.',
        ppe: [...BASE_PPE, 'gloves'],
      },
      {
        title: 'Trial lift and lift',
        description:
          'Carry out a trial lift just clear of the ground and confirm stability and balance. Complete the lift under the direction of the appointed person with the banksman in continuous communication with the operator.',
        ppe: BASE_PPE,
      },
      {
        title: 'Land, de-rig and stand down',
        description:
          'Land the load on prepared bearers, de-rig the accessories, stow the equipment and stand down the exclusion zone.',
        ppe: [...BASE_PPE, 'gloves'],
      },
      {
        title: 'Hand back and record the lift',
        description: 'Record the lift, hand the area back to the site contact and sign out.',
        ppe: BASE_PPE,
      },
    ],
    emergency: {
      firstAid: 'Crew first aider on site with a first-aid kit.',
      emergencyProcedure:
        'On a dropped or unstable load, stop the lift, keep everyone clear of the load path, do not approach a suspended unstable load, and raise the alarm. Call 999 for any injury.',
    },
    logistics: {
      welfare: 'Site welfare facilities used by arrangement with the principal contractor.',
      environmental: 'Drip trays under the crane. Noise limited to agreed working hours.',
      competence:
        'Appointed person, crane operator, slinger and banksman all hold current recognised competence for their role.',
    },
  },
  {
    title: 'General maintenance visit',
    trade: 'maintenance',
    scopeOfWorks:
      'Routine planned maintenance visit to an occupied building, covering inspection, servicing and minor repair across building services.',
    steps: [
      {
        title: 'Arrive, sign in and take the induction',
        description:
          'Report to reception, sign in, take the site induction where required and confirm the work list with the site contact.',
        ppe: ['safety_footwear', 'hi_vis'],
      },
      {
        title: 'Carry out a point-of-work risk assessment',
        description:
          'Before starting each task, assess the immediate work area for hazards that were not foreseen, and stop and re-plan if anything has changed.',
        ppe: ['safety_footwear', 'hi_vis'],
      },
      {
        title: 'Segregate the work area from building occupants',
        description:
          'Put out barriers, cones and signage to keep occupants and the public away from the work. Never leave tools or an open panel unattended in an occupied area.',
        ppe: ['safety_footwear', 'hi_vis'],
      },
      {
        title: 'Isolate where required and prove dead',
        description:
          'Where the task requires it, isolate the equipment, lock off, tag and prove dead at the point of work before starting.',
        ppe: [...BASE_PPE, 'gloves'],
        holdPoint: {
          kind: 'isolation_proved',
          description:
            'Any task requiring isolation does not start until the isolation is proved at the point of work.',
        },
      },
      {
        title: 'Carry out the maintenance tasks',
        description:
          'Complete the tasks on the work list to the maintenance specification, using the correct tools and replacement parts.',
        ppe: [...BASE_PPE, 'gloves'],
      },
      {
        title: 'Test, clean down and remove waste',
        description:
          'Functionally test what has been worked on, clean the area, and remove all waste and packaging from site.',
        ppe: [...BASE_PPE, 'gloves'],
      },
      {
        title: 'Report defects and hand back',
        description:
          'Report any defects found but not rectified to the site contact in writing, hand back the areas worked in, complete the service sheet and sign out.',
        ppe: ['safety_footwear', 'hi_vis'],
      },
    ],
    emergency: {
      firstAid:
        'Crew first aider carries a first-aid kit. Site first-aid arrangements taken at induction.',
      emergencyProcedure:
        'Follow the site emergency procedure taken at induction. On the alarm, stop work, make the area safe and evacuate to the site muster point.',
    },
    logistics: {
      welfare: 'Site welfare facilities used by arrangement with the site contact.',
      environmental:
        'All waste removed from site under the company waste route. No waste left in occupied areas.',
      accessEgress: 'Access via the agreed route. Fire exits and escape routes never obstructed.',
    },
  },
];
