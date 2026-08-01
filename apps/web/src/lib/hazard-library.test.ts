import { describe, expect, it } from 'vitest';
import { HAZARD_LIBRARY, searchHazardLibrary } from './hazard-library';

describe('hazard library', () => {
  it('every entry is complete and score-valid', () => {
    for (const h of HAZARD_LIBRARY) {
      expect(h.label.length).toBeGreaterThan(0);
      expect(h.harmDescription.length).toBeGreaterThan(0);
      expect(h.affectedGroups.length).toBeGreaterThan(0);
      expect(h.controls.length).toBeGreaterThan(0);
      for (const v of [
        h.initial.likelihood,
        h.initial.severity,
        h.residual.likelihood,
        h.residual.severity,
      ]) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(5);
      }
      // Residual must never exceed initial — the library models controls
      // reducing risk, and a worse-after-controls entry would be nonsense.
      expect(h.residual.likelihood * h.residual.severity).toBeLessThanOrEqual(
        h.initial.likelihood * h.initial.severity,
      );
    }
  });

  it('ids are unique', () => {
    const ids = HAZARD_LIBRARY.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('searches labels and keywords case-insensitively', () => {
    expect(searchHazardLibrary('LADDER').some((h) => h.id === 'work-at-height')).toBe(true);
    expect(searchHazardLibrary('forklift').some((h) => h.id === 'workplace-transport')).toBe(true);
    expect(searchHazardLibrary('zzz-nothing')).toHaveLength(0);
  });

  it('empty query returns the top picks, bounded by limit', () => {
    expect(searchHazardLibrary('')).toHaveLength(6);
    expect(searchHazardLibrary('', 3)).toHaveLength(3);
  });
});
