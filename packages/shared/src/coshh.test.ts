/**
 * Unit tests for the COSHH domain helpers.
 *
 * Edge cases covered (module-level IDs, see coshh router tests for the rest):
 *   - CO-E01: H350/H340/H334 infer carcinogen / mutagen / asthmagen; other
 *     codes do not
 *   - CO-E02: substitution priority — CMR → required, asthmagen or
 *     suspected CMR → strongly advised, else standard
 *   - CO-E03: storage incompatibility matrix is symmetric and conflict
 *     finding skips unclassified items
 *   - CO-E04: WEL comparison returns null (not false) on unit mismatch or
 *     missing limit
 *   - CO-E05: the SDS extraction schema rejects malformed H/P codes and
 *     unknown pictograms
 */
import { describe, expect, it } from 'vitest';
import {
  exceedsWel,
  findStorageConflicts,
  inferRegimeFlags,
  parseSdsExtraction,
  storageClassesConflict,
  storageLocationKey,
  substitutionPriority,
  suggestStorageClass,
  validateLevIntervalMonths,
} from './coshh';

describe('inferRegimeFlags (CO-E01)', () => {
  it('flags carcinogen for H350 and H350i only', () => {
    expect(inferRegimeFlags(['H350']).carcinogen).toBe(true);
    expect(inferRegimeFlags(['H350i']).carcinogen).toBe(true);
    expect(inferRegimeFlags(['H351']).carcinogen).toBe(false);
    expect(inferRegimeFlags(['H315', 'H319']).carcinogen).toBe(false);
  });

  it('flags mutagen for H340 and asthmagen for H334', () => {
    const flags = inferRegimeFlags(['H340', 'H334']);
    expect(flags.mutagen).toBe(true);
    expect(flags.asthmagen).toBe(true);
    expect(inferRegimeFlags(['H341']).mutagen).toBe(false);
    expect(inferRegimeFlags(['H317']).asthmagen).toBe(false);
  });
});

describe('substitutionPriority (CO-E02)', () => {
  it('requires substitution consideration for CMR', () => {
    expect(substitutionPriority(inferRegimeFlags(['H350']))).toBe('required');
    expect(substitutionPriority(inferRegimeFlags(['H340']))).toBe('required');
  });

  it('strongly advises for asthmagens and suspected CMRs', () => {
    expect(substitutionPriority(inferRegimeFlags(['H334']))).toBe('strongly_advised');
    expect(substitutionPriority(inferRegimeFlags(['H351']), ['H351'])).toBe('strongly_advised');
    expect(substitutionPriority(inferRegimeFlags(['H341']), ['H341'])).toBe('strongly_advised');
  });

  it('is standard otherwise', () => {
    expect(substitutionPriority(inferRegimeFlags(['H315']), ['H315'])).toBe('standard');
  });
});

describe('storage incompatibility (CO-E03)', () => {
  it('is symmetric', () => {
    expect(storageClassesConflict('flammable', 'oxidiser')).toBe(true);
    expect(storageClassesConflict('oxidiser', 'flammable')).toBe(true);
    expect(storageClassesConflict('corrosive_acid', 'corrosive_base')).toBe(true);
    expect(storageClassesConflict('flammable', 'toxic')).toBe(false);
    expect(storageClassesConflict('general', 'general')).toBe(false);
  });

  it('finds every conflicting pair and skips unclassified items', () => {
    const items = [
      { id: 'a', storageClass: 'flammable' as const },
      { id: 'b', storageClass: 'oxidiser' as const },
      { id: 'c', storageClass: null },
      { id: 'd', storageClass: 'corrosive_acid' as const },
      { id: 'e', storageClass: 'corrosive_base' as const },
    ];
    const conflicts = findStorageConflicts(items);
    const keys = conflicts.map((c) => `${c.a.id}-${c.b.id}`).sort();
    expect(keys).toEqual(['a-b', 'b-d', 'd-e']);
  });

  it('suggests a class from pictograms, refusing to guess acid vs base', () => {
    expect(suggestStorageClass(['GHS02', 'GHS07'])).toBe('flammable');
    expect(suggestStorageClass(['GHS03'])).toBe('oxidiser');
    expect(suggestStorageClass(['GHS05'])).toBeNull();
    expect(suggestStorageClass(['GHS08'])).toBe('general');
    expect(suggestStorageClass([])).toBeNull();
  });

  it('NR-09: acids conflict with the toxic class (cyanides/sulfides liberate HCN/H2S)', () => {
    expect(storageClassesConflict('corrosive_acid', 'toxic')).toBe(true);
    expect(storageClassesConflict('toxic', 'corrosive_acid')).toBe(true);
    // Bases do not — the matrix stays a matrix, not a blanket.
    expect(storageClassesConflict('corrosive_base', 'toxic')).toBe(false);
  });
});

describe('storageLocationKey (NR-09)', () => {
  it('normalises free text so case and whitespace variants share a key', () => {
    expect(storageLocationKey(null, '  COSHH Cupboard ')).toBe(
      storageLocationKey(null, 'coshh cupboard'),
    );
    expect(storageLocationKey(null, 'COSHH   Cupboard')).toBe('|coshh cupboard');
  });

  it('an unknown location (no site, no text) never conflicts', () => {
    expect(storageLocationKey(null, '')).toBeNull();
    expect(storageLocationKey(null, '   ')).toBeNull();
  });

  it('site-only keys are equal; the same site with different text is a different place', () => {
    expect(storageLocationKey('site1', '')).toBe(storageLocationKey('site1', ' '));
    expect(storageLocationKey('site1', 'store a')).not.toBe(storageLocationKey('site1', 'store b'));
    expect(storageLocationKey('site1', '')).not.toBe(storageLocationKey('site2', ''));
  });
});

describe('validateLevIntervalMonths (NR-08)', () => {
  it('accepts 1..14 and returns the parsed value', () => {
    expect(validateLevIntervalMonths('14')).toEqual({ ok: true, value: 14 });
    expect(validateLevIntervalMonths('1')).toEqual({ ok: true, value: 1 });
    expect(validateLevIntervalMonths(' 6 ')).toEqual({ ok: true, value: 6 });
  });

  it('refuses over-statutory, non-integer and empty input — never rewrites it', () => {
    expect(validateLevIntervalMonths('18')).toEqual({ ok: false });
    expect(validateLevIntervalMonths('15')).toEqual({ ok: false });
    expect(validateLevIntervalMonths('0')).toEqual({ ok: false });
    expect(validateLevIntervalMonths('')).toEqual({ ok: false });
    expect(validateLevIntervalMonths('abc')).toEqual({ ok: false });
    expect(validateLevIntervalMonths('7.5')).toEqual({ ok: false });
  });
});

describe('exceedsWel (CO-E04)', () => {
  const wel = {
    agent: 'toluene',
    twa8h: { value: 50, unit: 'ppm' as const },
    stel15min: { value: 100, unit: 'ppm' as const },
    source: 'EH40',
  };

  it('compares against the matching period', () => {
    expect(exceedsWel({ value: 60, unit: 'ppm', period: 'twa8h' }, wel)).toBe(true);
    expect(exceedsWel({ value: 40, unit: 'ppm', period: 'twa8h' }, wel)).toBe(false);
    expect(exceedsWel({ value: 100, unit: 'ppm', period: 'stel15min' }, wel)).toBe(false);
  });

  it('returns null on unit mismatch or missing limit — never a silent pass', () => {
    expect(exceedsWel({ value: 60, unit: 'mg/m3', period: 'twa8h' }, wel)).toBeNull();
    expect(
      exceedsWel({ value: 60, unit: 'ppm', period: 'stel15min' }, { ...wel, stel15min: null }),
    ).toBeNull();
  });
});

describe('sdsExtractionSchema (CO-E05)', () => {
  it('accepts a well-formed extraction and applies defaults', () => {
    const parsed = parseSdsExtraction({
      productName: 'Acetone 99.5%',
      hStatements: [{ code: 'H225', text: 'Highly flammable liquid and vapour.' }],
      pStatements: [{ code: 'P210', text: 'Keep away from heat.' }],
      pictograms: ['GHS02', 'GHS07'],
      workplaceExposureLimits: [
        { agent: 'acetone', twa8h: { value: 500, unit: 'ppm' }, stel15min: null },
      ],
      issueDate: '2024-03-01',
    });
    expect(parsed.supplier).toBe('');
    expect(parsed.confidence).toBe('medium');
    expect(parsed.workplaceExposureLimits[0]?.source).toBe('');
  });

  it('accepts combined P codes and EUH codes', () => {
    const parsed = parseSdsExtraction({
      productName: 'X',
      hStatements: [{ code: 'EUH066', text: 'Repeated exposure may cause skin dryness.' }],
      pStatements: [{ code: 'P305+P351+P338', text: 'IF IN EYES: rinse.' }],
    });
    expect(parsed.hStatements).toHaveLength(1);
  });

  it('rejects malformed codes and unknown pictograms', () => {
    expect(() =>
      parseSdsExtraction({
        productName: 'X',
        hStatements: [{ code: 'HX15', text: 'nope' }],
      }),
    ).toThrow();
    expect(() =>
      parseSdsExtraction({
        productName: 'X',
        pictograms: ['GHS42'],
      }),
    ).toThrow();
    expect(() => parseSdsExtraction({ productName: '' })).toThrow();
  });
});
