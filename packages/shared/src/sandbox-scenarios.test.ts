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
import {
  SANDBOX_SCENARIOS,
  defaultRefinement,
  isSandboxScenarioId,
  resolveSandboxChoice,
  scenariosForBrand,
} from './sandbox-scenarios';

describe('sandbox scenario catalogue', () => {
  it('SB-E10 — Forma360 only offers tiles built on core modules', () => {
    const ids = scenariosForBrand('forma360').map((s) => s.id);
    expect(ids).toEqual(['inspection', 'hazard']);
  });

  it('SB-E11 — FreeHS offers every tile', () => {
    const ids = scenariosForBrand('freehs').map((s) => s.id);
    expect(ids).toEqual(SANDBOX_SCENARIOS.map((s) => s.id));
  });

  it('SB-E12 — refinements needing an absent module are dropped', () => {
    const forma = scenariosForBrand('forma360').find((s) => s.id === 'inspection');
    // fireChecks needs the fireSafety module, which Forma360 does not ship.
    expect(forma?.refinements.map((r) => r.id)).not.toContain('fireChecks');

    const freehs = scenariosForBrand('freehs').find((s) => s.id === 'inspection');
    expect(freehs?.refinements.map((r) => r.id)).toContain('fireChecks');
  });

  it('SB-E13 — a tile the brand does not ship cannot be provisioned', () => {
    expect(
      resolveSandboxChoice('forma360', { scenarioId: 'permit', refinementId: 'hotWork' }),
    ).toBeNull();
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
