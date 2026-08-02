'use client';

import { useTranslations } from 'next-intl';
import {
  bandChipClasses,
  bandForScore,
  type MatrixThresholds,
  type RiskBand,
} from '../../lib/risk-matrix';

/**
 * Small coloured chip showing the band for a likelihood×severity score.
 * Pass `band` when the caller already knows it (severity floors need the
 * severity, which a bare score cannot carry).
 */
export function RiskBandChip({
  score,
  matrix,
  band,
  showScore = true,
}: {
  score: number | null;
  matrix: MatrixThresholds;
  /** Explicit band override — wins over the score-derived band. */
  band?: RiskBand;
  showScore?: boolean;
}) {
  const t = useTranslations('riskAssessments');
  const resolved = band ?? bandForScore(score, matrix);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${bandChipClasses(resolved)}`}
    >
      {t(`band.${resolved}`)}
      {showScore && score !== null && score > 0 ? <span aria-hidden="true">· {score}</span> : null}
    </span>
  );
}
