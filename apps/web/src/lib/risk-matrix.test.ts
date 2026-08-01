import { describe, expect, it } from 'vitest';
import { bandForScore, scoreFor, type MatrixThresholds } from './risk-matrix';

const DEFAULT: MatrixThresholds = { lowMax: 4, mediumMax: 9, highMax: 15 };

describe('scoreFor', () => {
  it('multiplies likelihood × severity', () => {
    expect(scoreFor(3, 4)).toBe(12);
  });
  it('returns null when either side is unscored', () => {
    expect(scoreFor(null, 4)).toBeNull();
    expect(scoreFor(3, null)).toBeNull();
    expect(scoreFor(undefined, undefined)).toBeNull();
  });
});

describe('bandForScore', () => {
  it('maps the default 5×5 thresholds to bands', () => {
    expect(bandForScore(null, DEFAULT)).toBe('none');
    expect(bandForScore(1, DEFAULT)).toBe('low');
    expect(bandForScore(4, DEFAULT)).toBe('low');
    expect(bandForScore(5, DEFAULT)).toBe('medium');
    expect(bandForScore(9, DEFAULT)).toBe('medium');
    expect(bandForScore(10, DEFAULT)).toBe('high');
    expect(bandForScore(15, DEFAULT)).toBe('high');
    expect(bandForScore(16, DEFAULT)).toBe('critical');
    expect(bandForScore(25, DEFAULT)).toBe('critical');
  });
  it('respects custom thresholds', () => {
    const strict: MatrixThresholds = { lowMax: 2, mediumMax: 6, highMax: 12 };
    expect(bandForScore(4, strict)).toBe('medium');
    expect(bandForScore(13, strict)).toBe('critical');
  });
});
