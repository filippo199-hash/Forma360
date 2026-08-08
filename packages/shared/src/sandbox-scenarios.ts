/**
 * Sandbox scenario catalogue — what "Try it now" can build for a visitor
 * before they have an account (ADR 0017).
 *
 * The catalogue is *data*, not behaviour: a tile, its refinements, the
 * brand-only module each one needs, and the route the visitor lands on.
 * Seeding lives in `@forma360/api` (it needs the db); labels live in
 * i18n (nothing user-facing is spelled here — ground rule 3).
 *
 * Brand gating follows ADR 0010 place 3: a tile is offered only when the
 * active brand ships the module behind it, resolved through
 * `brandHasModule`. There is no `if (brand === 'freehs')` here — add a
 * module to `BRAND_MODULES` and its tile appears; remove it and the tile
 * disappears, in both the UI and the provisioning endpoint.
 *
 * Two levels, deliberately. Level 1 is a job the visitor recognises
 * ("Permits to work"); level 2 forks what actually gets built. A
 * refinement earns its place only if a different answer produces a
 * visibly different workspace — anything that merely tags a record is
 * asked for after the workspace exists, not at the door.
 */
import { z } from 'zod';
import { brandHasModule, getBrand, type BrandId, type BrandOnlyModule } from './brand';

export const SANDBOX_SCENARIO_IDS = [
  'riskAssessment',
  'inspection',
  'hazard',
  'permit',
  'incident',
  'rams',
] as const;

export type SandboxScenarioId = (typeof SANDBOX_SCENARIO_IDS)[number];

export interface SandboxRefinement {
  readonly id: string;
  /** Pre-selected so a hurried visitor can continue with one tap. */
  readonly isDefault?: boolean;
  /**
   * Brand-only module this refinement needs on top of the tile's own.
   * A refinement whose module the brand does not ship is filtered out.
   */
  readonly requiresModule?: BrandOnlyModule;
  /** Locale-relative landing route, when it differs from the tile's. */
  readonly landingPath?: string;
}

export interface SandboxScenario {
  readonly id: SandboxScenarioId;
  /** Brand-only module the whole tile depends on. */
  readonly requiresModule?: BrandOnlyModule;
  /** Locale-relative route the visitor lands on once seeding is done. */
  readonly landingPath: string;
  /**
   * What the visitor must find when they land — the tile's contract.
   *
   * This is not documentation. `provision.goals.test.ts` walks every
   * tile and every refinement and asserts the goal against the real
   * database, so a tile whose seed does not deliver its goal fails the
   * suite. A tile that promises a site-walkthrough template and drops
   * the visitor on an empty register is the exact failure this field
   * exists to make impossible.
   */
  readonly goal: string;
  readonly refinements: readonly SandboxRefinement[];
}

/**
 * The six tiles, ordered by how well each demonstrates the product in
 * the first ninety seconds — not by how important the module is
 * internally. A tile earns its place only if a stranger can make a real
 * decision and walk out holding a document with their name on it, which
 * is why Documents, Sites and Settings are seeded-but-not-tiled.
 */
export const SANDBOX_SCENARIOS: readonly SandboxScenario[] = [
  {
    id: 'riskAssessment',
    requiresModule: 'riskAssessments',
    landingPath: '/risk-assessments',
    goal: 'A draft risk assessment with worked hazards and controls, and one hazard left unrated for the visitor to judge. The COSHH and fire refinements instead land on their own module with a substance / building already on file.',
    refinements: [
      { id: 'general', isDefault: true },
      { id: 'coshh', requiresModule: 'coshh', landingPath: '/coshh' },
      { id: 'fire', requiresModule: 'fireSafety', landingPath: '/fire-safety' },
      { id: 'manualHandling' },
    ],
  },
  {
    id: 'inspection',
    landingPath: '/inspections',
    goal: 'A published template matching the chosen subject, ready to run, plus one inspection genuinely part-answered by a named colleague — not an empty shell with a status badge.',
    refinements: [
      { id: 'siteWalk', isDefault: true },
      { id: 'equipment' },
      { id: 'vehicles' },
      { id: 'fireChecks', requiresModule: 'fireSafety' },
    ],
  },
  {
    id: 'hazard',
    landingPath: '/observations',
    goal: 'An observation register with three reports, two still open and one already closed out, spread across both sites and across the past fortnight. The withActions refinement also raises a corrective action against each open report.',
    refinements: [
      { id: 'captureOnly' },
      { id: 'withActions', isDefault: true },
      { id: 'anonymous' },
    ],
  },
  {
    id: 'permit',
    requiresModule: 'permits',
    landingPath: '/permits',
    goal: 'The nine default permit types, plus one permit of the chosen category raised and waiting on the visitor — with the gas readings and authorising signature its own type demands already on the record.',
    refinements: [
      { id: 'hotWork', isDefault: true },
      { id: 'confinedSpace' },
      { id: 'workingAtHeight' },
      { id: 'electrical' },
    ],
  },
  {
    id: 'incident',
    requiresModule: 'incidents',
    landingPath: '/incidents',
    goal: 'One incident at reported, with the injured person, an open absence period and a severity that agree with the description, so the RIDDOR screening is a real judgement rather than a prop.',
    refinements: [
      { id: 'recordOnly' },
      { id: 'withInvestigation' },
      { id: 'withRiddor', isDefault: true },
    ],
  },
  {
    id: 'rams',
    requiresModule: 'rams',
    landingPath: '/rams',
    goal: 'A RAMS pack with method-statement steps the visitor can read and build on. The reviewPack refinement also puts a contractor pack in the review queue, because that is the page it lands on.',
    refinements: [
      { id: 'reviewPack', isDefault: true },
      { id: 'buildPack' },
      { id: 'contractorDocs' },
    ],
  },
];

/** Type guard for an untrusted scenario id. */
export function isSandboxScenarioId(value: unknown): value is SandboxScenarioId {
  return typeof value === 'string' && (SANDBOX_SCENARIO_IDS as readonly string[]).includes(value);
}

export const sandboxScenarioIdSchema = z.enum(SANDBOX_SCENARIO_IDS);

/**
 * Zod schema for a sandbox request. The refinement is validated against
 * the scenario in {@link resolveSandboxChoice} rather than here — the
 * pair has to be checked together, and the brand matters.
 */
export const sandboxChoiceSchema = z.object({
  scenarioId: sandboxScenarioIdSchema,
  refinementId: z.string().min(1).max(40),
});

export type SandboxChoice = z.infer<typeof sandboxChoiceSchema>;

/**
 * The tiles this brand can offer, with unavailable refinements dropped.
 *
 * Empty for a brand that does not offer the sandbox at all — which is
 * the single switch the whole feature hangs off. `/try` 404s, the
 * creation endpoint 404s, and the hero falls back to sign-up, all from
 * this one return value.
 */
export function scenariosForBrand(brand: BrandId): readonly SandboxScenario[] {
  if (!getBrand(brand).offersSandbox) return [];
  return SANDBOX_SCENARIOS.filter(
    (s) => s.requiresModule === undefined || brandHasModule(brand, s.requiresModule),
  ).map((s) => ({
    ...s,
    refinements: s.refinements.filter(
      (r) => r.requiresModule === undefined || brandHasModule(brand, r.requiresModule),
    ),
  }));
}

/** A validated tile + refinement pair, with the route to land on. */
export interface ResolvedSandboxChoice {
  readonly scenario: SandboxScenario;
  readonly refinement: SandboxRefinement;
  /** Locale-relative landing route (refinement wins over tile). */
  readonly landingPath: string;
}

/**
 * Resolve an untrusted `{scenarioId, refinementId}` against the active
 * brand. Returns null when the tile is not offered by this brand, or the
 * refinement does not belong to the tile — the caller turns that into a
 * 400 rather than silently substituting a default, so a stale bookmark
 * never provisions the wrong workspace.
 */
export function resolveSandboxChoice(
  brand: BrandId,
  choice: SandboxChoice,
): ResolvedSandboxChoice | null {
  const scenario = scenariosForBrand(brand).find((s) => s.id === choice.scenarioId);
  if (scenario === undefined) return null;

  const refinement = scenario.refinements.find((r) => r.id === choice.refinementId);
  if (refinement === undefined) return null;

  return {
    scenario,
    refinement,
    landingPath: refinement.landingPath ?? scenario.landingPath,
  };
}

/** The pre-selected refinement for a tile, or its first one. */
export function defaultRefinement(scenario: SandboxScenario): SandboxRefinement | undefined {
  return scenario.refinements.find((r) => r.isDefault) ?? scenario.refinements[0];
}
