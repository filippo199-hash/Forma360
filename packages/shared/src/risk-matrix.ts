/**
 * Risk-matrix banding for the Risk Assessments module (FreeHS B1).
 *
 * The one canonical implementation, shared by the API (publish
 * validation), the web app (matrix pickers, chips, print) and the render
 * package (PDF). Scores are likelihood × severity (1–5 each, so 1–25).
 *
 * Band thresholds — and the optional severity floors that stop a
 * fatality-potential hazard being labelled "Medium" just because its
 * likelihood is 1 — come from the assessment row's `matrix` snapshot, so
 * historic scores stay stable when a tenant edits their matrix.
 */

export const RISK_BAND_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskBandLevel = (typeof RISK_BAND_LEVELS)[number];

/** `none` = not scored yet. */
export type RiskBand = 'none' | RiskBandLevel;

export interface RiskMatrixConfig {
  /** Score ≤ lowMax → low; ≤ mediumMax → medium; ≤ highMax → high; else critical. */
  lowMax: number;
  mediumMax: number;
  highMax: number;
  /**
   * Per-severity minimum band ("severity 5 ⇒ at least high"), keyed by
   * the severity value as a string ('1'…'5'). Older snapshots don't have
   * the key — absent/empty means thresholds alone decide the band.
   */
  severityFloors?: Record<string, RiskBandLevel>;
}

export const DEFAULT_RISK_MATRIX: RiskMatrixConfig = { lowMax: 4, mediumMax: 9, highMax: 15 };

const BAND_ORDER: Record<RiskBand, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function isRiskBandLevel(value: unknown): value is RiskBandLevel {
  return typeof value === 'string' && (RISK_BAND_LEVELS as ReadonlyArray<string>).includes(value);
}

/** Numeric rank for comparing bands (none < low < medium < high < critical). */
export function bandRank(band: RiskBand): number {
  return BAND_ORDER[band];
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

/**
 * Threshold-only banding. Use {@link bandFor} whenever the severity is
 * known — this variant cannot apply severity floors and exists for
 * aggregate scores (e.g. "worst residual score across hazards").
 */
export function bandForScore(score: number | null, m: RiskMatrixConfig): RiskBand {
  if (score === null || score <= 0) return 'none';
  if (score <= m.lowMax) return 'low';
  if (score <= m.mediumMax) return 'medium';
  if (score <= m.highMax) return 'high';
  return 'critical';
}

/**
 * Full banding for a likelihood × severity pair: thresholds first, then
 * the severity floor (if the matrix defines one for this severity and it
 * out-ranks the threshold band).
 */
export function bandFor(
  likelihood: number | null | undefined,
  severity: number | null | undefined,
  m: RiskMatrixConfig,
): RiskBand {
  const score = scoreFor(likelihood, severity);
  const band = bandForScore(score, m);
  if (band === 'none' || severity === null || severity === undefined) return band;
  const floor = m.severityFloors?.[String(severity)];
  if (floor !== undefined && BAND_ORDER[floor] > BAND_ORDER[band]) return floor;
  return band;
}

/**
 * The worst residual band across a set of scored pairs — the list-row
 * summary. Severity floors apply per pair, so a 1×5 hazard under a
 * "severity 5 ⇒ high" floor correctly dominates a 2×2.
 */
export function worstBand(
  pairs: ReadonlyArray<{ likelihood: number | null; severity: number | null }>,
  m: RiskMatrixConfig,
): RiskBand {
  let worst: RiskBand = 'none';
  for (const p of pairs) {
    const band = bandFor(p.likelihood, p.severity, m);
    if (BAND_ORDER[band] > BAND_ORDER[worst]) worst = band;
  }
  return worst;
}

/** Validate a matrix config's internal consistency (editor + API guard). */
export function isValidMatrixConfig(m: RiskMatrixConfig): boolean {
  return (
    Number.isInteger(m.lowMax) &&
    Number.isInteger(m.mediumMax) &&
    Number.isInteger(m.highMax) &&
    m.lowMax >= 1 &&
    m.lowMax < m.mediumMax &&
    m.mediumMax < m.highMax &&
    m.highMax < 25
  );
}
