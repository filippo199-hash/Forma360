/**
 * Risk-matrix banding for the Risk Assessments module (FreeHS B1).
 *
 * Scores are likelihood × severity (1–5 each, so 1–25). Band thresholds
 * come from the assessment row's `matrix` snapshot so historic scores stay
 * stable if the tenant's matrix ever changes.
 */

export type RiskBand = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface MatrixThresholds {
  lowMax: number;
  mediumMax: number;
  highMax: number;
}

export function scoreFor(
  likelihood: number | null | undefined,
  severity: number | null | undefined,
): number | null {
  if (
    likelihood === null ||
    likelihood === undefined ||
    severity === null ||
    severity === undefined
  ) {
    return null;
  }
  return likelihood * severity;
}

export function bandForScore(score: number | null, m: MatrixThresholds): RiskBand {
  if (score === null || score <= 0) return 'none';
  if (score <= m.lowMax) return 'low';
  if (score <= m.mediumMax) return 'medium';
  if (score <= m.highMax) return 'high';
  return 'critical';
}

/** Chip styling per band — readable in light and dark. */
export function bandChipClasses(band: RiskBand): string {
  switch (band) {
    case 'low':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
    case 'medium':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
    case 'high':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
    case 'critical':
      return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
    case 'none':
      return 'bg-muted text-muted-foreground';
  }
}
