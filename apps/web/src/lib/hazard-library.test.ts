/**
 * Hazard library integrity — the scrape-and-fail pattern from
 * `search-categories.test.ts`, applied to the quick-add library.
 *
 * The trap this closes: `hazard.affectedGroups` is free-string jsonb and
 * the chip label is a VARIABLE-KEYED t() call
 * (`t(\`hazards.groups.${g}\`)`), so a template shipping a group key with
 * no preset (and therefore no label anywhere) renders the raw key path
 * on screen and in the printed record — the exact FRA-bug class K01
 * cannot see. Every library group must be a preset, or deliberately
 * human-readable free text (none today).
 */
import { AFFECTED_GROUP_PRESETS } from '@forma360/db/schema';
import { describe, expect, it } from 'vitest';
import { HAZARD_LIBRARY, searchHazardLibrary } from './hazard-library';

describe('hazard library', () => {
  it('every template affectedGroups value is a preset (label-less keys are the FRA-bug class)', () => {
    const presets = new Set<string>(AFFECTED_GROUP_PRESETS);
    for (const tpl of HAZARD_LIBRARY) {
      for (const group of tpl.affectedGroups) {
        expect(presets, `${tpl.id} names unknown group '${group}'`).toContain(group);
      }
    }
  });

  it('template ids are unique', () => {
    const ids = HAZARD_LIBRARY.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('care-sector entries surface by search and default to residents_service_users', () => {
    // The care persona types what they know — the equipment or the injury.
    const hoist = searchHazardLibrary('hoist');
    expect(hoist.map((t) => t.id)).toContain('moving-handling-people');
    const scald = searchHazardLibrary('scald');
    expect(scald.map((t) => t.id)).toContain('scalding-hot-water');
    const outbreak = searchHazardLibrary('outbreak');
    expect(outbreak.map((t) => t.id)).toContain('infection-outbreak');

    const careIds = [
      'moving-handling-people',
      'scalding-hot-water',
      'medication-errors',
      'bed-rails-falls-from-bed',
      'challenging-behaviour',
      'infection-outbreak',
    ];
    for (const id of careIds) {
      const tpl = HAZARD_LIBRARY.find((t) => t.id === id);
      expect(tpl, `care template ${id} missing`).toBeDefined();
      expect(tpl?.affectedGroups).toContain('residents_service_users');
      // Realistic tiered controls, not a bare one-liner.
      expect((tpl?.controls.length ?? 0) >= 3).toBe(true);
    }
  });
});
