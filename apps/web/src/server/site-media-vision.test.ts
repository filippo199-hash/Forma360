import { describe, expect, it } from 'vitest';
import { coerceResult, parseJsonObject } from './site-media-vision-parse';

describe('site-media-vision parsing', () => {
  it('extracts a JSON object embedded in prose', () => {
    const text =
      'Here you go:\n{"tags":["ladder","scaffold"],"caption":"A ladder."}\nHope that helps.';
    expect(parseJsonObject(text)).toEqual({
      tags: ['ladder', 'scaffold'],
      caption: 'A ladder.',
    });
  });

  it('returns null when there is no JSON object', () => {
    expect(parseJsonObject('no json here')).toBeNull();
  });

  it('normalises tags: lowercases, trims, dedupes length, caps at 8', () => {
    const result = coerceResult({
      tags: ['  Ladder ', 'SCAFFOLD', '', 'x'.repeat(50), 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      caption: '  A scene.  ',
    });
    expect(result.tags).toContain('ladder');
    expect(result.tags).toContain('scaffold');
    expect(result.tags).not.toContain(''); // empty dropped
    expect(result.tags.every((t) => t.length <= 40)).toBe(true); // 50-char dropped
    expect(result.tags.length).toBeLessThanOrEqual(8);
    expect(result.caption).toBe('A scene.');
  });

  it('degrades to empty result on malformed input', () => {
    expect(coerceResult(null)).toEqual({ tags: [], caption: '' });
    expect(coerceResult({ tags: 'not-an-array' })).toEqual({ tags: [], caption: '' });
  });
});
