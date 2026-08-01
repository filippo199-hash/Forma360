'use client';

import { useTranslations } from 'next-intl';
import { bandChipClasses, bandForScore, type MatrixThresholds } from '../../lib/risk-matrix';

/** Small coloured chip showing the band for a likelihood×severity score. */
export function RiskBandChip({
  score,
  matrix,
  showScore = true,
}: {
  score: number | null;
  matrix: MatrixThresholds;
  showScore?: boolean;
}) {
  const t = useTranslations('riskAssessments');
  const band = bandForScore(score, matrix);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${bandChipClasses(band)}`}
    >
      {t(`band.${band}`)}
      {showScore && score !== null && score > 0 ? <span aria-hidden="true">· {score}</span> : null}
    </span>
  );
}
