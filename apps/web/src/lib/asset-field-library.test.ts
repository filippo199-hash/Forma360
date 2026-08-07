/**
 * Asset category → suggested field matching.
 *
 * Edge cases:
 *   - AS-SG01: the reported case — typing "Cars" proposes vehicle fields
 *   - AS-SG02: real phrasings match ("Site vehicles", "Fork lift trucks")
 *   - AS-SG03: a substring must not hijack a word ("Cargo" is not "car")
 *   - AS-SG04: an unknown category yields nothing, so the AI fallback runs
 *   - AS-SG05: every template is internally sound — unique keys, options
 *     only on select fields, and at least one pre-ticked recommendation
 */
import { describe, expect, it } from 'vitest';
import {
  ASSET_CATEGORY_LIBRARY,
  matchAssetCategory,
  suggestFieldsFor,
} from './asset-field-library';

describe('asset field suggestions', () => {
  it('AS-SG01: "Cars" proposes the vehicle fields, registration first', () => {
    const fields = suggestFieldsFor('Cars');
    const names = fields.map((f) => f.name);
    expect(names).toContain('Registration');
    expect(names).toContain('MOT due');
    // Pre-ticked = the near-essential ones only, so "Add selected" is a
    // sensible default rather than everything.
    const recommended = fields.filter((f) => f.recommended).map((f) => f.name);
    expect(recommended).toContain('Registration');
    expect(recommended.length).toBeLessThan(fields.length);
  });

  it('AS-SG02: the phrasings people actually type still match', () => {
    expect(matchAssetCategory('Site vehicles')?.id).toBe('vehicle');
    // A fork lift is thorough-examination plant, not an MOT-and-road-tax
    // vehicle — and people write the compound either way.
    expect(matchAssetCategory('Fork lift trucks')?.id).toBe('plant');
    expect(matchAssetCategory('Forklifts')?.id).toBe('plant');
    expect(matchAssetCategory('Ladders and steps')?.id).toBe('access');
    expect(matchAssetCategory('Fire extinguishers')?.id).toBe('fire');
    expect(matchAssetCategory('Lifting accessories')?.id).toBe('lifting');
    expect(matchAssetCategory('LAPTOPS')?.id).toBe('it');
  });

  it('AS-SG03: a substring inside another word does not hijack the match', () => {
    // "Cargo" contains "car"; matching it would propose an MOT date for a
    // shipping container, which is exactly the kind of wrong suggestion
    // that teaches people to ignore the panel.
    expect(matchAssetCategory('Cargo')).toBeNull();
    expect(matchAssetCategory('Scaffold')?.id).toBe('access');
  });

  it('AS-SG04: an unknown category suggests nothing, so the AI fallback runs', () => {
    expect(suggestFieldsFor('Autoclaves')).toEqual([]);
    expect(suggestFieldsFor('Widgets')).toEqual([]);
    // Too short to mean anything — never guess from one letter.
    expect(suggestFieldsFor('c')).toEqual([]);
    expect(suggestFieldsFor('   ')).toEqual([]);
  });

  it('AS-SG05: every template is internally sound', () => {
    for (const template of ASSET_CATEGORY_LIBRARY) {
      const fields = suggestFieldsFor(template.keywords[0] ?? template.label);
      expect(fields.length, `${template.id} suggests nothing`).toBeGreaterThan(0);

      // Duplicate keys would collide when the caller mints field ids —
      // templates spread shared field sets, so this is a real risk.
      const keys = fields.map((f) => f.key);
      expect(new Set(keys).size, `${template.id} has duplicate keys`).toBe(keys.length);

      for (const field of fields) {
        expect(field.name.trim(), `${template.id}.${field.key} unnamed`).not.toBe('');
        expect(field.hint.trim(), `${template.id}.${field.key} has no hint`).not.toBe('');
        if (field.fieldType === 'select') {
          expect(
            (field.options ?? []).length,
            `${template.id}.${field.key} is a select with no options`,
          ).toBeGreaterThan(1);
        } else {
          expect(
            field.options,
            `${template.id}.${field.key} has options but is not a select`,
          ).toBeUndefined();
        }
      }

      // At least one pre-ticked field, or "Add selected" starts disabled.
      expect(
        fields.some((f) => f.recommended),
        `${template.id} recommends nothing`,
      ).toBe(true);
    }
  });
});
