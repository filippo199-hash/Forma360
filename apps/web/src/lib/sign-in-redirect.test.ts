import { describe, expect, it } from 'vitest';
import { DEFAULT_SIGNED_IN_PATH, isSafeNextPath, safeNextPath, signInHref } from './sign-in-redirect';

describe('sign-in-redirect', () => {
  describe('isSafeNextPath / safeNextPath — open-redirect guard', () => {
    it('accepts local paths under the current locale', () => {
      expect(isSafeNextPath('/en/inspections/01ABC', 'en')).toBe(true);
      expect(safeNextPath('/en/inspections/01ABC', 'en')).toBe('/en/inspections/01ABC');
    });

    it('rejects absolute URLs and protocol-relative paths (open redirect)', () => {
      for (const evil of ['https://evil.com', 'http://evil.com', '//evil.com', '///evil.com']) {
        expect(isSafeNextPath(evil, 'en')).toBe(false);
        expect(safeNextPath(evil, 'en')).toBe('/en/templates');
      }
    });

    it('rejects backslash normalisation tricks', () => {
      expect(isSafeNextPath('/en/\\evil.com', 'en')).toBe(false);
      expect(isSafeNextPath('/\\evil.com', 'en')).toBe(false);
    });

    it('rejects paths outside the current locale, empty, and nullish', () => {
      expect(isSafeNextPath('/fr/inspections', 'en')).toBe(false);
      expect(isSafeNextPath('/eninspections', 'en')).toBe(false); // no slash after locale
      expect(isSafeNextPath('', 'en')).toBe(false);
      expect(isSafeNextPath(null, 'en')).toBe(false);
      expect(isSafeNextPath(undefined, 'en')).toBe(false);
      expect(safeNextPath(null, 'en')).toBe(DEFAULT_SIGNED_IN_PATH('en'));
    });
  });

  describe('signInHref', () => {
    it('preserves a local path as ?next=', () => {
      expect(signInHref('en', '/en/actions/01XYZ')).toBe(
        '/en/sign-in?next=%2Fen%2Factions%2F01XYZ',
      );
    });

    it('omits ?next= for the homepage or an unsafe path', () => {
      expect(signInHref('en', '/en')).toBe('/en/sign-in');
      expect(signInHref('en', 'https://evil.com')).toBe('/en/sign-in');
      expect(signInHref('en', null)).toBe('/en/sign-in');
    });
  });
});
