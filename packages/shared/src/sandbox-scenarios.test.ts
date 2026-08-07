/**
 * Sandbox catalogue — brand gating and choice resolution.
 *
 * Edge-case IDs:
 *   SB-E10 — Forma360 offers only the tiles built on core modules.
 *   SB-E11 — FreeHS offers every tile.
 *   SB-E12 — refinements needing a module the brand lacks are dropped.
 *   SB-E13 — a tile the brand does not ship cannot be provisioned.
 *   SB-E14 — a refinement that belongs to another tile is rejected.
 *   SB-E15 — the refinement's landing route wins over the tile's.
 *   SB-E16 — every tile has exactly one default refinement.
 */
import { describe, expect, it } from 'vitest';
import { BRAND_IDS, brandHasModule } from './brand';
import {
  SANDBOX_SCENARIOS,
  defaultRefinement,
  isSandboxScenarioId,
  resolveSandboxChoice,
  scenariosForBrand,
} from './sandbox-scenarios';

describe('sandbox scenario catalogue', () => {
  it('SB-E10 — a brand that does not offer the sandbox gets no tiles at all', () => {
    // Forma360 sells through demos; the sandbox is FreeHS-only. This one
    // return value is what 404s /try and the creation endpoint there.
    expect(scenariosForBrand('forma360')).toEqual([]);
  });

  it('SB-E11 — FreeHS offers every tile', () => {
    const ids = scenariosForBrand('freehs').map((s) => s.id);
    expect(ids).toEqual(SANDBOX_SCENARIOS.map((s) => s.id));
  });

  it('SB-E12 — a brand is never offered a tile or refinement it cannot ship', () => {
    // The invariant that matters: whatever survives the filter is
    // backed by a module the brand actually has.
    for (const brand of BRAND_IDS) {
      for (const scenario of scenariosForBrand(brand)) {
        if (scenario.requiresModule !== undefined) {
          expect(brandHasModule(brand, scenario.requiresModule)).toBe(true);
        }
        for (const refinement of scenario.refinements) {
          if (refinement.requiresModule !== undefined) {
            expect(brandHasModule(brand, refinement.requiresModule)).toBe(true);
          }
        }
      }
    }

    // FreeHS ships fireSafety, so the fire-checks refinement is offered.
    const freehs = scenariosForBrand('freehs').find((s) => s.id === 'inspection');
    expect(freehs?.refinements.map((r) => r.id)).toContain('fireChecks');
  });

  it('SB-E13 — nothing can be provisioned for a brand without the sandbox', () => {
    for (const scenario of SANDBOX_SCENARIOS) {
      for (const refinement of scenario.refinements) {
        expect(
          resolveSandboxChoice('forma360', {
            scenarioId: scenario.id,
            refinementId: refinement.id,
          }),
        ).toBeNull();
      }
    }
    expect(
      resolveSandboxChoice('freehs', { scenarioId: 'permit', refinementId: 'hotWork' }),
    ).not.toBeNull();
  });

  it('SB-E14 — a refinement from another tile is rejected', () => {
    expect(
      resolveSandboxChoice('freehs', { scenarioId: 'permit', refinementId: 'general' }),
    ).toBeNull();
    expect(
      resolveSandboxChoice('freehs', { scenarioId: 'permit', refinementId: 'nope' }),
    ).toBeNull();
  });

  it("SB-E15 — the refinement's landing route wins over the tile's", () => {
    const general = resolveSandboxChoice('freehs', {
      scenarioId: 'riskAssessment',
      refinementId: 'general',
    });
    expect(general?.landingPath).toBe('/risk-assessments');

    const coshh = resolveSandboxChoice('freehs', {
      scenarioId: 'riskAssessment',
      refinementId: 'coshh',
    });
    expect(coshh?.landingPath).toBe('/coshh');
  });

  it('SB-E16 — every tile has exactly one default refinement', () => {
    for (const scenario of SANDBOX_SCENARIOS) {
      const defaults = scenario.refinements.filter((r) => r.isDefault === true);
      expect(defaults, `${scenario.id} defaults`).toHaveLength(1);
      expect(defaultRefinement(scenario)?.id).toBe(defaults[0]?.id);
    }
  });

  it('rejects unknown scenario ids at the type guard', () => {
    expect(isSandboxScenarioId('permit')).toBe(true);
    expect(isSandboxScenarioId('nonsense')).toBe(false);
    expect(isSandboxScenarioId(42)).toBe(false);
  });
});
