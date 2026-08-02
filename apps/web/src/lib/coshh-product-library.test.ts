import { PHYSICAL_FORMS, STORAGE_CLASSES } from '@forma360/shared/coshh';
import { describe, expect, it } from 'vitest';
import { COSHH_PRODUCT_LIBRARY, searchCoshhProductLibrary } from './coshh-product-library';

describe('coshh product library', () => {
  it('every entry is complete and uses catalogue vocabulary', () => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const p of COSHH_PRODUCT_LIBRARY) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(names.has(p.name.toLowerCase())).toBe(false);
      names.add(p.name.toLowerCase());
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.supplier.length).toBeGreaterThan(0);
      expect(p.usage.length).toBeGreaterThan(0);
      expect(p.keywords.length).toBeGreaterThan(0);
      expect(PHYSICAL_FORMS).toContain(p.physicalForm);
      if (p.storageClass !== undefined) {
        expect(STORAGE_CLASSES).toContain(p.storageClass);
      }
      // Keywords are matched lowercased — they must be stored that way.
      for (const k of p.keywords) expect(k).toBe(k.toLowerCase());
    }
    expect(COSHH_PRODUCT_LIBRARY.length).toBeGreaterThanOrEqual(20);
  });

  it('empty query returns the top picks, capped', () => {
    const top = searchCoshhProductLibrary('');
    expect(top.length).toBeLessThanOrEqual(8);
    expect(top[0]?.id).toBe(COSHH_PRODUCT_LIBRARY[0]?.id);
  });

  it('matches name, supplier and keywords case-insensitively', () => {
    expect(searchCoshhProductLibrary('WD-40').some((p) => p.id === 'wd40')).toBe(true);
    expect(searchCoshhProductLibrary('boc').some((p) => p.id === 'oxygen')).toBe(true);
    expect(searchCoshhProductLibrary('DRAIN').some((p) => p.id === 'caustic-soda')).toBe(true);
    expect(searchCoshhProductLibrary('zzz-no-match')).toHaveLength(0);
  });
});
