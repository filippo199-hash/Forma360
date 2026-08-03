/**
 * Brand catalogue — the single source of truth for every product identity
 * this codebase ships under. See ADR 0010 (multi-brand, single codebase).
 *
 * One deployment serves exactly one brand, selected by the `BRAND` env var
 * (server) and its build-time mirror `NEXT_PUBLIC_BRAND` (client bundle).
 * The env schema refuses a deployment where the two disagree.
 *
 * Ground rules for brand differences (ADR 0010):
 *   - Brand differences live in exactly four places: this config, the
 *     module catalogue (future), i18n message overrides, and entitlement
 *     defaults (future). Never in inline `if (brand === 'x')` conditionals
 *     inside core logic.
 *   - Everything internal (package scope, queue names, table names, object
 *     keys) stays `forma360` regardless of brand. Users never see those.
 */
import { z } from 'zod';

export const BRAND_IDS = ['forma360', 'freehs'] as const;

export type BrandId = (typeof BRAND_IDS)[number];

export const brandIdSchema = z.enum(BRAND_IDS);

export const DEFAULT_BRAND_ID: BrandId = 'forma360';

/**
 * Everything user-visible that differs between brands. Pure serialisable
 * data — safe to import from server code, client components, and jobs.
 */
export interface BrandConfig {
  readonly id: BrandId;
  /** Product / trading name shown to users everywhere. */
  readonly name: string;
  /** Canonical public origin, e.g. "https://forma360.io". */
  readonly website: string;
  /** Apex domain, e.g. "forma360.io". */
  readonly domain: string;
  /** Public support inbox. Must forward to a monitored inbox. */
  readonly supportEmail: string;
  /** Privacy / data-request inbox shown in legal documents. */
  readonly privacyEmail: string;
  /** Registered legal-entity name (Companies House). */
  readonly legalName: string;
  /** Companies House registration number. */
  readonly companyNumber: string;
  /** Full descriptor for the opening line of legal documents. */
  readonly legalEntity: string;
  /** Registered office address. */
  readonly address: string;
  /** Country of establishment / governing law. */
  readonly jurisdiction: string;
}

export const BRANDS: Record<BrandId, BrandConfig> = {
  forma360: {
    id: 'forma360',
    name: 'Forma360',
    website: 'https://forma360.io',
    domain: 'forma360.io',
    supportEmail: 'support@forma360.io',
    privacyEmail: 'privacy@forma360.io',
    legalName: 'Forma360 Ltd',
    companyNumber: '17292397',
    legalEntity:
      'Forma360 Ltd, a company registered in England and Wales under company number 17292397',
    address: '128 City Road, London, EC1V 2NX, United Kingdom',
    jurisdiction: 'England and Wales',
  },
  freehs: {
    id: 'freehs',
    name: 'FreeHS',
    website: 'https://freehs.software',
    domain: 'freehs.software',
    supportEmail: 'support@freehs.software',
    privacyEmail: 'privacy@freehs.software',
    // FreeHS launches as a trading name of the existing entity. Confirm the
    // final legal structure before the freehs.software legal pages go live.
    legalName: 'Forma360 Ltd',
    companyNumber: '17292397',
    legalEntity:
      'FreeHS, a trading name of Forma360 Ltd, a company registered in England and Wales under company number 17292397',
    address: '128 City Road, London, EC1V 2NX, United Kingdom',
    jurisdiction: 'England and Wales',
  },
};

export function isBrandId(value: unknown): value is BrandId {
  return typeof value === 'string' && (BRAND_IDS as readonly string[]).includes(value);
}

/**
 * Resolve untrusted input (env var, build-time constant) to a BrandId,
 * falling back to the default brand. Use this at boundaries where the env
 * schema has not already validated the value (e.g. client bundles, the
 * next-intl request config).
 */
export function resolveBrandId(value: unknown): BrandId {
  return isBrandId(value) ? value : DEFAULT_BRAND_ID;
}

export function getBrand(id: BrandId): BrandConfig {
  return BRANDS[id];
}

// ─── Module catalogue (ADR 0010, place 3 of 4) ───────────────────────────────

/** Modules that exist only in some brands. Core modules are not listed. */
export const BRAND_ONLY_MODULES = [
  'riskAssessments',
  'coshh',
  'permits',
  'fireSafety',
  'incidents',
] as const;

export type BrandOnlyModule = (typeof BRAND_ONLY_MODULES)[number];

/**
 * Which brand-only modules each product ships. Core modules (inspections,
 * issues, actions, …) exist everywhere and are governed by permissions
 * only; this catalogue gates the brand-specific surface on top.
 */
export const BRAND_MODULES: Record<BrandId, ReadonlyArray<BrandOnlyModule>> = {
  forma360: [],
  freehs: ['riskAssessments', 'coshh', 'permits', 'fireSafety', 'incidents'],
};

export function brandHasModule(id: BrandId, module: BrandOnlyModule): boolean {
  return BRAND_MODULES[id].includes(module);
}
