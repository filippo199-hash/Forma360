/**
 * COSHH domain helpers (FreeHS module B2).
 *
 * Pure data + functions shared by the DB schema, the API router, the web
 * UI and the AI import boundary:
 *   - GHS pictogram / signal-word / H- and P-statement vocabulary;
 *   - special-regime inference from H statements (carcinogen, mutagen,
 *     asthmagen) and the substitution-first priority derived from it;
 *   - storage-class incompatibility matrix + conflict finder;
 *   - workplace exposure limit (WEL) shapes and the monitoring-result
 *     comparison;
 *   - `sdsExtractionSchema` — the Zod boundary every AI-extracted safety
 *     data sheet passes through before we trust it (ground rule 2).
 *
 * Everything here is deterministic and side-effect free so both the tRPC
 * layer and client components can import it.
 */
import { z } from 'zod';

// ─── GHS vocabulary ─────────────────────────────────────────────────────────

/** CLP/GHS hazard pictogram codes. Labels are i18n keys (`coshh.pictograms.*`). */
export const GHS_PICTOGRAMS = [
  'GHS01', // explosive
  'GHS02', // flammable
  'GHS03', // oxidising
  'GHS04', // gas under pressure
  'GHS05', // corrosive
  'GHS06', // acute toxicity
  'GHS07', // harmful / irritant
  'GHS08', // serious health hazard
  'GHS09', // hazardous to the environment
] as const;
export type GhsPictogram = (typeof GHS_PICTOGRAMS)[number];

export const SIGNAL_WORDS = ['danger', 'warning'] as const;
export type SignalWord = (typeof SIGNAL_WORDS)[number];

/** Physical form of the substance as supplied / used. */
export const PHYSICAL_FORMS = [
  'liquid',
  'solid',
  'powder',
  'gas',
  'aerosol',
  'fume',
  'mist',
  'fibre',
  'other',
] as const;
export type PhysicalForm = (typeof PHYSICAL_FORMS)[number];

/** H315, H350i, EUH066, … */
const H_CODE_RE = /^(?:H\d{3}[A-Za-z]{0,2}|EUH\d{3}[A-Za-z]?)$/;
/** P280, P301+P310, … */
const P_CODE_RE = /^P\d{3}(?:\+P\d{3})*$/;

export const hStatementSchema = z.object({
  code: z.string().regex(H_CODE_RE, 'invalid H-statement code'),
  text: z.string().min(1).max(500),
});
export type HStatement = z.infer<typeof hStatementSchema>;

export const pStatementSchema = z.object({
  code: z.string().regex(P_CODE_RE, 'invalid P-statement code'),
  text: z.string().min(1).max(500),
});
export type PStatement = z.infer<typeof pStatementSchema>;

// ─── Special-regime inference ───────────────────────────────────────────────

/**
 * Regimes COSHH (and its sibling regulations) treat specially. Carcinogen /
 * mutagen / asthmagen are inferable from H statements; biological agents and
 * lead are declared manually; asbestos is out of COSHH scope entirely — a
 * substance flagged `asbestosReferral` is managed under CAR 2012 and this
 * module only records the referral.
 */
export interface RegimeFlags {
  carcinogen: boolean;
  mutagen: boolean;
  /** Respiratory sensitiser (H334) — asthmagen. */
  asthmagen: boolean;
}

const CARCINOGEN_CODES = new Set(['H350', 'H350i']);
const SUSPECTED_CMR_CODES = new Set(['H351', 'H341']);
const MUTAGEN_CODES = new Set(['H340']);
const ASTHMAGEN_CODES = new Set(['H334']);

/**
 * Infer the inferable regime flags from a list of H-statement codes.
 * Category-1 classifications only (H350/H350i, H340, H334) — suspected
 * carcinogens / mutagens (H351/H341) do not trigger the strict regime but
 * do raise the substitution priority below.
 */
export function inferRegimeFlags(hCodes: ReadonlyArray<string>): RegimeFlags {
  return {
    carcinogen: hCodes.some((c) => CARCINOGEN_CODES.has(c)),
    mutagen: hCodes.some((c) => MUTAGEN_CODES.has(c)),
    asthmagen: hCodes.some((c) => ASTHMAGEN_CODES.has(c)),
  };
}

/**
 * How hard the module pushes substitution for this substance:
 *   - `required` — carcinogens and mutagens: COSHH reg 7(5) demands
 *     substitution be considered first; an assessment cannot publish while
 *     the substance's substitution status is still `not_assessed`.
 *   - `strongly_advised` — asthmagens and suspected CMRs (H351/H341):
 *     the UI leads with substitution but publish is not blocked on it.
 *   - `standard` — ordinary hierarchy-of-control prompting.
 */
export type SubstitutionPriority = 'required' | 'strongly_advised' | 'standard';

export function substitutionPriority(
  flags: RegimeFlags,
  hCodes: ReadonlyArray<string> = [],
): SubstitutionPriority {
  if (flags.carcinogen || flags.mutagen) return 'required';
  if (flags.asthmagen || hCodes.some((c) => SUSPECTED_CMR_CODES.has(c))) {
    return 'strongly_advised';
  }
  return 'standard';
}

// ─── Storage classes + incompatibility ──────────────────────────────────────

/**
 * Segregation buckets for storage. `corrosive_acid` / `corrosive_base` are
 * split because acid–base is the classic same-cupboard reaction; GHS05 alone
 * cannot tell them apart, so the suggestion below returns null for it and the
 * user picks.
 */
export const STORAGE_CLASSES = [
  'flammable',
  'oxidiser',
  'corrosive_acid',
  'corrosive_base',
  'toxic',
  'compressed_gas',
  'water_reactive',
  'general',
] as const;
export type StorageClass = (typeof STORAGE_CLASSES)[number];

/** Unordered pairs that must not share a store. */
const INCOMPATIBLE_PAIRS: ReadonlyArray<readonly [StorageClass, StorageClass]> = [
  ['flammable', 'oxidiser'],
  ['corrosive_acid', 'corrosive_base'],
  ['corrosive_acid', 'water_reactive'],
  ['corrosive_base', 'water_reactive'],
  ['oxidiser', 'corrosive_acid'],
];

export function storageClassesConflict(a: StorageClass, b: StorageClass): boolean {
  return INCOMPATIBLE_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

export interface StorageConflict<T> {
  a: T;
  b: T;
}

/**
 * Find every conflicting pair among substances stored in the same place.
 * Items with `storageClass: null` (not yet classified) never conflict.
 */
export function findStorageConflicts<T extends { storageClass: StorageClass | null }>(
  items: ReadonlyArray<T>,
): Array<StorageConflict<T>> {
  const out: Array<StorageConflict<T>> = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a === undefined || b === undefined) continue;
      if (a.storageClass === null || b.storageClass === null) continue;
      if (storageClassesConflict(a.storageClass, b.storageClass)) {
        out.push({ a, b });
      }
    }
  }
  return out;
}

/**
 * Suggest a storage class from the pictogram set. GHS05 (corrosive) returns
 * null — acid vs base is not derivable from the pictogram, so the user must
 * choose. Order matters: the physically dominant hazard wins.
 */
export function suggestStorageClass(pictograms: ReadonlyArray<string>): StorageClass | null {
  const set = new Set(pictograms);
  if (set.has('GHS01') || set.has('GHS02')) return 'flammable';
  if (set.has('GHS03')) return 'oxidiser';
  if (set.has('GHS04')) return 'compressed_gas';
  if (set.has('GHS05')) return null;
  if (set.has('GHS06')) return 'toxic';
  if (set.has('GHS07') || set.has('GHS08') || set.has('GHS09')) return 'general';
  return null;
}

// ─── Workplace exposure limits ──────────────────────────────────────────────

export const WEL_UNITS = ['mg/m3', 'ppm', 'fibres/ml'] as const;
export type WelUnit = (typeof WEL_UNITS)[number];

export const welLimitSchema = z.object({
  value: z.number().positive(),
  unit: z.enum(WEL_UNITS),
});
export type WelLimit = z.infer<typeof welLimitSchema>;

/**
 * One workplace exposure limit entry, per agent (a mixture's SDS can list
 * several constituent agents each with their own EH40 limit).
 */
export const welSchema = z.object({
  /** The agent the limit applies to, e.g. "toluene". */
  agent: z.string().min(1).max(200),
  /** Long-term limit — 8-hour time-weighted average. */
  twa8h: welLimitSchema.nullable(),
  /** Short-term limit — 15-minute reference period. */
  stel15min: welLimitSchema.nullable(),
  /** Where the number came from, e.g. "EH40/2005 (2025)". */
  source: z.string().max(200).default(''),
});
export type WorkplaceExposureLimit = z.infer<typeof welSchema>;

export const MONITORING_PERIODS = ['twa8h', 'stel15min'] as const;
export type MonitoringPeriod = (typeof MONITORING_PERIODS)[number];

/**
 * Compare a monitoring result to a WEL. Returns true/false when the limit
 * for that period exists in the same unit, or null when no comparison is
 * possible (missing limit or unit mismatch) — the caller must surface
 * "not comparable" rather than silently passing it.
 */
export function exceedsWel(
  result: { value: number; unit: WelUnit; period: MonitoringPeriod },
  wel: WorkplaceExposureLimit,
): boolean | null {
  const limit = result.period === 'twa8h' ? wel.twa8h : wel.stel15min;
  if (limit === null || limit.unit !== result.unit) return null;
  return result.value > limit.value;
}

// ─── Review-age defaults ────────────────────────────────────────────────────

/**
 * How old a safety data sheet may grow before the module prompts for a
 * check with the supplier. There is no statutory SDS expiry — three years
 * is the common practitioner default; editable per substance.
 */
export const DEFAULT_SDS_REVIEW_MONTHS = 36;

/**
 * Statutory maximum interval between thorough examination and tests of
 * local exhaust ventilation (COSHH reg 9 / HSG258): fourteen months.
 */
export const STATUTORY_LEV_TEST_INTERVAL_MONTHS = 14;

/** Default COSHH assessment review cycle (practitioner default, editable). */
export const DEFAULT_ASSESSMENT_REVIEW_MONTHS = 12;

// ─── AI SDS-extraction boundary ─────────────────────────────────────────────

/**
 * What the Claude SDS reader returns, validated before anything reaches the
 * form or the database. Every field is optional-ish on purpose: a partial
 * extraction pre-fills what it can and the user completes the rest.
 */
export const sdsExtractionSchema = z.object({
  productName: z.string().min(1).max(300),
  supplier: z.string().max(300).default(''),
  /** Catalogue / article / UFI identifier if the sheet carries one. */
  productIdentifier: z.string().max(200).default(''),
  physicalForm: z.enum(PHYSICAL_FORMS).nullable().default(null),
  signalWord: z.enum(SIGNAL_WORDS).nullable().default(null),
  /** GHS hazard classes, e.g. "Flam. Liq. 2", "Skin Corr. 1B". */
  hazardClassification: z.array(z.string().min(1).max(120)).max(30).default([]),
  hStatements: z.array(hStatementSchema).max(40).default([]),
  pStatements: z.array(pStatementSchema).max(60).default([]),
  pictograms: z.array(z.enum(GHS_PICTOGRAMS)).max(9).default([]),
  workplaceExposureLimits: z.array(welSchema).max(20).default([]),
  /** SDS section 7 storage guidance, condensed. */
  storageRequirements: z.string().max(2000).default(''),
  /** Revision / issue date printed on the sheet, ISO yyyy-mm-dd. */
  issueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  /** The model's own read on extraction quality; low → UI warns loudly. */
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
});
export type SdsExtraction = z.infer<typeof sdsExtractionSchema>;

/** Parse untrusted AI output into an SdsExtraction. Throws ZodError. */
export function parseSdsExtraction(input: unknown): SdsExtraction {
  return sdsExtractionSchema.parse(input);
}
