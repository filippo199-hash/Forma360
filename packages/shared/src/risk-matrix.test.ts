/**
 * Unit tests for the shared risk-matrix banding (FreeHS B1).
 *
 * Edge cases:
 *   - RM-E01: default thresholds band exactly at the documented cut-offs
 *   - RM-E02: severity floors raise the band but never lower it (P-4 —
 *     "1×5 asbestos residual must not read Medium" once a floor is set)
 *   - RM-E03: worstBand applies floors per pair, not on the max score
 *   - RM-E04: config validation rejects non-monotonic thresholds
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RISK_MATRIX,
  bandFor,
  bandForScore,
  bandRank,
  isValidMatrixConfig,
  scoreFor,
  worstBand,
  type RiskMatrixConfig,
} from './risk-matrix';

describe('risk-matrix', () => {
  it('RM-E01: default thresholds band at the documented cut-offs', () => {
    expect(bandForScore(null, DEFAULT_RISK_MATRIX)).toBe('none');
    expect(bandForScore(1, DEFAULT_RISK_MATRIX)).toBe('low');
    expect(bandForScore(4, DEFAULT_RISK_MATRIX)).toBe('low');
    expect(bandForScore(5, DEFAULT_RISK_MATRIX)).toBe('medium');
    expect(bandForScore(9, DEFAULT_RISK_MATRIX)).toBe('medium');
    expect(bandForScore(10, DEFAULT_RISK_MATRIX)).toBe('high');
    expect(bandForScore(15, DEFAULT_RISK_MATRIX)).toBe('high');
    expect(bandForScore(16, DEFAULT_RISK_MATRIX)).toBe('critical');
    expect(bandForScore(25, DEFAULT_RISK_MATRIX)).toBe('critical');
    expect(scoreFor(3, 4)).toBe(12);
    expect(scoreFor(null, 4)).toBeNull();
  });

  it('RM-E02: severity floors raise the band but never lower it', () => {
    const withFloor: RiskMatrixConfig = {
      ...DEFAULT_RISK_MATRIX,
      severityFloors: { '5': 'high' },
    };
    // 1×5 = 5 would be Medium by thresholds; the floor lifts it to High.
    expect(bandFor(1, 5, withFloor)).toBe('high');
    // Floors never demote: 5×5 = 25 stays Critical despite the 'high' floor.
    expect(bandFor(5, 5, withFloor)).toBe('critical');
    // Other severities are untouched.
    expect(bandFor(1, 4, withFloor)).toBe('low');
    // No floor configured → plain thresholds.
    expect(bandFor(1, 5, DEFAULT_RISK_MATRIX)).toBe('medium');
    // Unscored stays none even with floors present.
    expect(bandFor(null, 5, withFloor)).toBe('none');
  });

  it('RM-E03: worstBand applies floors per pair, not on the max score', () => {
    const withFloor: RiskMatrixConfig = {
      ...DEFAULT_RISK_MATRIX,
      severityFloors: { '5': 'high' },
    };
    // Max score is 2×3=6 (Medium), but the 1×5 pair floors to High —
    // the summary must say High.
    const band = worstBand(
      [
        { likelihood: 2, severity: 3 },
        { likelihood: 1, severity: 5 },
      ],
      withFloor,
    );
    expect(band).toBe('high');
    expect(worstBand([], withFloor)).toBe('none');
    expect(bandRank('critical')).toBeGreaterThan(bandRank('high'));
  });

  it('RM-E04: config validation rejects non-monotonic thresholds', () => {
    expect(isValidMatrixConfig({ lowMax: 4, mediumMax: 9, highMax: 15 })).toBe(true);
    expect(isValidMatrixConfig({ lowMax: 9, mediumMax: 9, highMax: 15 })).toBe(false);
    expect(isValidMatrixConfig({ lowMax: 4, mediumMax: 16, highMax: 15 })).toBe(false);
    expect(isValidMatrixConfig({ lowMax: 0, mediumMax: 9, highMax: 15 })).toBe(false);
    expect(isValidMatrixConfig({ lowMax: 4, mediumMax: 9, highMax: 25 })).toBe(false);
    expect(isValidMatrixConfig({ lowMax: 4.5, mediumMax: 9, highMax: 15 })).toBe(false);
  });
});
