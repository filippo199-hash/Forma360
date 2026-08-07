import { describe, expect, it } from 'vitest';
import { BRAND_IDS, BRANDS, DEFAULT_BRAND_ID, getBrand, isBrandId, resolveBrandId } from './brand';

describe('brand catalogue', () => {
  it('has a complete config for every brand id', () => {
    for (const id of BRAND_IDS) {
      const brand = BRANDS[id];
      expect(brand.id).toBe(id);
      // Every identity string must be present and non-empty; capability
      // flags (offersSandbox) are booleans and simply have to be set.
      for (const value of Object.values(brand)) {
        if (typeof value === 'boolean') continue;
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
      expect(typeof brand.offersSandbox).toBe('boolean');
    }
  });

  it('keeps forma360 as the default brand', () => {
    expect(DEFAULT_BRAND_ID).toBe('forma360');
    expect(getBrand(DEFAULT_BRAND_ID).name).toBe('Forma360');
  });

  it('defines FreeHS against freehs.software', () => {
    const freehs = getBrand('freehs');
    expect(freehs.name).toBe('FreeHS');
    expect(freehs.domain).toBe('freehs.software');
    expect(freehs.website).toBe('https://freehs.software');
    expect(freehs.supportEmail.endsWith('@freehs.software')).toBe(true);
  });

  it('isBrandId accepts known ids and rejects everything else', () => {
    expect(isBrandId('forma360')).toBe(true);
    expect(isBrandId('freehs')).toBe(true);
    expect(isBrandId('FreeHS')).toBe(false);
    expect(isBrandId('')).toBe(false);
    expect(isBrandId(undefined)).toBe(false);
    expect(isBrandId(42)).toBe(false);
  });

  it('resolveBrandId falls back to the default brand on unknown input', () => {
    expect(resolveBrandId('freehs')).toBe('freehs');
    expect(resolveBrandId('forma360')).toBe('forma360');
    expect(resolveBrandId(undefined)).toBe(DEFAULT_BRAND_ID);
    expect(resolveBrandId('safetyculture')).toBe(DEFAULT_BRAND_ID);
  });
});
