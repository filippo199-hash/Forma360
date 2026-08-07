/**
 * Asset custom-field helpers.
 *
 * The bug these exist for: custom fields were rendered on the **create**
 * page and nowhere else. So a value typed at creation was invisible and
 * uneditable forever after, and changing an asset's type to one that
 * defines fields left no way to fill them in — the type changed, the
 * fields never appeared.
 *
 * Edge cases:
 *   - AS-CF01: a jsonb blob of any shape is read without crashing the page
 *   - AS-CF02: numbers and booleans survive as their string form
 *   - AS-CF03: "required" means the same thing on create and on edit
 *   - AS-CF04: values from a previous type are preserved across a type
 *     change, so switching back does not silently destroy data
 */
import { describe, expect, it } from 'vitest';
import { customFieldsOf, customFieldValuesOf, firstMissingRequired } from './custom-field-inputs';

const FIELDS = [
  { id: 'reg', name: 'Registration', fieldType: 'text' as const, required: true },
  { id: 'mot', name: 'MOT due', fieldType: 'date' as const },
];

describe('asset custom fields', () => {
  it('AS-CF01: a malformed jsonb blob reads as empty, never a crash', () => {
    // `customFields` and `customFieldValues` are jsonb, so they arrive as
    // unknown. A bad row must not take the whole asset page down.
    expect(customFieldsOf(null)).toEqual([]);
    expect(customFieldsOf(undefined)).toEqual([]);
    expect(customFieldsOf({ customFields: 'not-an-array' })).toEqual([]);
    expect(customFieldsOf({ customFields: FIELDS })).toEqual(FIELDS);

    expect(customFieldValuesOf({ customFieldValues: null })).toEqual({});
    expect(customFieldValuesOf({ customFieldValues: ['a'] })).toEqual({});
    expect(customFieldValuesOf({})).toEqual({});
  });

  it('AS-CF02: non-string values survive as strings the inputs can render', () => {
    // A number typed into a `number` field round-trips through jsonb as a
    // number; the input is a controlled string.
    expect(
      customFieldValuesOf({ customFieldValues: { mileage: 42, serviced: true, reg: 'AB12 CDE' } }),
    ).toEqual({ mileage: '42', serviced: 'true', reg: 'AB12 CDE' });
    // Anything else (objects, nulls) is dropped rather than rendered as
    // "[object Object]".
    expect(customFieldValuesOf({ customFieldValues: { nested: { a: 1 }, missing: null } })).toEqual(
      {},
    );
  });

  it('AS-CF03: required is unsatisfied by absence and by whitespace', () => {
    expect(firstMissingRequired(FIELDS, {})?.id).toBe('reg');
    expect(firstMissingRequired(FIELDS, { reg: '   ' })?.id).toBe('reg');
    expect(firstMissingRequired(FIELDS, { reg: 'AB12 CDE' })).toBeNull();
    // An optional field never blocks a save.
    expect(firstMissingRequired(FIELDS, { reg: 'AB12 CDE', mot: '' })).toBeNull();
  });

  it('AS-CF04: values from a previous type survive a type change', () => {
    // The detail page seeds its editor from the asset's WHOLE value map and
    // sends it back, so keys belonging to the old type ride along. Switch a
    // pump to a car and back, and the pump's readings are still there —
    // `customFieldValues` replaces the whole map, so anything it omits is
    // destroyed.
    const saved = customFieldValuesOf({
      customFieldValues: { pumpPressure: '4.2', pumpSerial: 'P-99' },
    });
    // The editor overlays the new type's fields on top of what was there.
    const afterEditingAsACar = { ...saved, reg: 'AB12 CDE' };
    expect(afterEditingAsACar).toEqual({
      pumpPressure: '4.2',
      pumpSerial: 'P-99',
      reg: 'AB12 CDE',
    });
    // …and the car's own required field is satisfied.
    expect(firstMissingRequired(FIELDS, afterEditingAsACar)).toBeNull();
  });
});
