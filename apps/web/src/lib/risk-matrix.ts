/**
 * Risk-matrix banding for the Risk Assessments module (FreeHS B1).
 *
 * The banding maths lives in `@forma360/shared/risk-matrix` (one canonical
 * implementation for API, web and render — including the per-severity
 * floors a tenant can configure). This module re-exports it and adds the
 * web-only Tailwind chip styling.
 */
import type { RiskBand } from '@forma360/shared/risk-matrix';

export {
  DEFAULT_RISK_MATRIX,
  bandFor,
  bandForScore,
  bandRank,
  scoreFor,
  worstBand,
} from '@forma360/shared/risk-matrix';
export type { RiskBand, RiskBandLevel, RiskMatrixConfig } from '@forma360/shared/risk-matrix';
/** Back-compat alias — pre-P-4 code imported the thresholds under this name. */
export type { RiskMatrixConfig as MatrixThresholds } from '@forma360/shared/risk-matrix';

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
