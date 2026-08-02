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
  issued: ['active', 'closed', 'cancelled'],
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

/** One atmosphere-test result recorded on the permit (jsonb entry). */
export const gasReadingSchema = z.object({
  id: z.string().min(1).max(40),
  substance: z.string().min(1).max(120),
  reading: z.number().finite(),
  unit: z.enum(GAS_READING_UNITS),
  takenAt: z.string().min(1),
  takenBy: z.string().min(1),
  takenByName: z.string().max(200),
  note: z.string().max(500),
});
export type GasReading = z.infer<typeof gasReadingSchema>;

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
}

/**
 * The nine permit types every new tenant starts with. Seeded once per
 * tenant (idempotent) and editable thereafter — these are sensible UK
 * practice defaults, not statutory text.
 */
export const DEFAULT_PERMIT_TYPES: ReadonlyArray<DefaultPermitType> = [
  {
    category: 'hot_work',
    name: 'Hot work',
    requiresAuthoriser: false,
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
