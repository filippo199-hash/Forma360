import { describe, expect, it } from 'vitest';
import { isId, newId } from './id';

describe('newId', () => {
  it('generates a 26-character ULID', () => {
    const id = newId();
    expect(id).toHaveLength(26);
  });

  it('uses Crockford base32 alphabet (no I, L, O, U)', () => {
    const id = newId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('generates unique ids on rapid successive calls', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newId()));
    expect(ids.size).toBe(10_000);
  });

  it('is approximately monotonic (timestamp prefix is non-decreasing)', () => {
    const a = newId();
    const b = newId();
    // ULID prefix (first 10 chars) is the timestamp in Crockford base32.
    const prefixA = a.slice(0, 10);
    const prefixB = b.slice(0, 10);
    expect(prefixB >= prefixA).toBe(true);
  });
});

describe('isId', () => {
  it('accepts a value returned by newId', () => {
    expect(isId(newId())).toBe(true);
  });

  it('rejects the empty string', () => {
    expect(isId('')).toBe(false);
  });

  it('rejects lowercase (ULIDs are uppercase only)', () => {
    expect(isId('01arz3ndektsv4rrffq69g5fav')).toBe(false);
  });

  it('rejects strings using letters outside the Crockford alphabet', () => {
    expect(isId('01ARZ3NDEKTSV4RRFFQ69G5FAI')).toBe(false); // contains I
    expect(isId('01ARZ3NDEKTSV4RRFFQ69G5FAL')).toBe(false); // contains L
    expect(isId('01ARZ3NDEKTSV4RRFFQ69G5FAO')).toBe(false); // contains O
    expect(isId('01ARZ3NDEKTSV4RRFFQ69G5FAU')).toBe(false); // contains U
  });

  it('rejects strings of the wrong length', () => {
    expect(isId('01ARZ3NDEKTSV4RRFFQ69G5FA')).toBe(false); // 25
    expect(isId('01ARZ3NDEKTSV4RRFFQ69G5FAVV')).toBe(false); // 27
  });

  it('rejects non-strings', () => {
    expect(isId(null)).toBe(false);
    expect(isId(undefined)).toBe(false);
    expect(isId(42)).toBe(false);
    expect(isId({})).toBe(false);
  });
});
