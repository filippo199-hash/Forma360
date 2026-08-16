/**
 * NR3-08 (part 1): the Substance requirement must be consistent — the
 * default is derived from the selected limit on EVERY render, not written
 * once by the select's change handler and lost on the post-record reset.
 * NR-03: the client refuses physically impossible readings before the
 * router does.
 */
import { describe, expect, it } from 'vitest';
import { resolveGasReadingDraft } from './gas-reading-form';

describe('resolveGasReadingDraft (NR3-08 / NR-03)', () => {
  it('limit selected + empty typed substance → records under the limit label', () => {
    const draft = resolveGasReadingDraft({
      typedSubstance: '',
      selectedLimitLabel: 'Oxygen (O₂)',
      reading: '20.9',
      unit: 'percent_o2',
    });
    expect(draft.substance).toBe('Oxygen (O₂)');
    expect(draft.canRecord).toBe(true);
  });

  it('free reading + empty substance → cannot record', () => {
    const draft = resolveGasReadingDraft({
      typedSubstance: '   ',
      selectedLimitLabel: null,
      reading: '12',
      unit: 'ppm',
    });
    expect(draft.substance).toBe('');
    expect(draft.canRecord).toBe(false);
  });

  it('typed substance overrides the limit label', () => {
    const draft = resolveGasReadingDraft({
      typedSubstance: 'H₂S at the manway',
      selectedLimitLabel: 'Oxygen (O₂)',
      reading: '5',
      unit: 'ppm',
    });
    expect(draft.substance).toBe('H₂S at the manway');
  });

  it('resolution is identical before and after the post-success reset', () => {
    // The reported inconsistency: after a successful record the reset
    // cleared the typed substance while the limit stayed selected — the
    // event-driven auto-fill did not re-fire, so the second reading was
    // refused. Derived resolution must not care which came first.
    const before = resolveGasReadingDraft({
      typedSubstance: '',
      selectedLimitLabel: 'Flammables (LEL)',
      reading: '2',
      unit: 'percent_lel',
    });
    const afterReset = resolveGasReadingDraft({
      typedSubstance: '', // reset wiped the field
      selectedLimitLabel: 'Flammables (LEL)', // limit still selected
      reading: '3',
      unit: 'percent_lel',
    });
    expect(before.canRecord).toBe(true);
    expect(afterReset.canRecord).toBe(true);
    expect(afterReset.substance).toBe('Flammables (LEL)');
  });

  it('NR-03: out-of-bounds readings cannot be recorded and flag the hint', () => {
    const negative = resolveGasReadingDraft({
      typedSubstance: 'LEL',
      selectedLimitLabel: null,
      reading: '-5',
      unit: 'percent_lel',
    });
    expect(negative.valueInBounds).toBe(false);
    expect(negative.canRecord).toBe(false);

    const absurd = resolveGasReadingDraft({
      typedSubstance: 'LEL',
      selectedLimitLabel: null,
      reading: '9999',
      unit: 'percent_lel',
    });
    expect(absurd.valueInBounds).toBe(false);
    expect(absurd.canRecord).toBe(false);

    // Empty / non-numeric input shows no bounds hint — it is simply not
    // recordable yet.
    const empty = resolveGasReadingDraft({
      typedSubstance: 'LEL',
      selectedLimitLabel: null,
      reading: '',
      unit: 'percent_lel',
    });
    expect(empty.valueInBounds).toBe(true);
    expect(empty.canRecord).toBe(false);

    // Oxygen enrichment is dangerous, possible, and must stay recordable.
    const enrichment = resolveGasReadingDraft({
      typedSubstance: 'O₂',
      selectedLimitLabel: null,
      reading: '40',
      unit: 'percent_o2',
    });
    expect(enrichment.canRecord).toBe(true);
  });
});
