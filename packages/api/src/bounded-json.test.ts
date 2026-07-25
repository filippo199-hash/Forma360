import { describe, expect, it } from 'vitest';
import { MAX_JSON_BYTES, boundedRecord } from './bounded-json';

describe('boundedRecord', () => {
  it('accepts a normal custom-field object', () => {
    const value = {
      name: 'Widget',
      qty: 3,
      tags: ['a', 'b'],
      meta: { color: 'red', geo: { lat: 1, lng: 2 } },
    };
    const result = boundedRecord.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) {
      // Output type is Record<string, unknown> — identical to z.record(z.unknown()).
      expect(result.data).toEqual(value);
    }
  });

  it('accepts an empty object', () => {
    expect(boundedRecord.safeParse({}).success).toBe(true);
  });

  it('rejects an oversized payload', () => {
    const value = { big: 'x'.repeat(MAX_JSON_BYTES + 1) };
    const result = boundedRecord.safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === 'payload too large')).toBe(true);
    }
  });

  it('rejects a too-deeply-nested payload', () => {
    // Build a small-but-very-deep object: passes the size bound, fails depth.
    let deep: unknown = 'leaf';
    for (let i = 0; i < 20; i++) deep = { nested: deep };
    const result = boundedRecord.safeParse({ root: deep });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === 'payload too deeply nested')).toBe(true);
    }
  });
});
