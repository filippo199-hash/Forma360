'use client';

import { useTranslations } from 'next-intl';
import { bandChipClasses, bandFor, type MatrixThresholds } from '../../lib/risk-matrix';

const STEPS = [1, 2, 3, 4, 5] as const;

/**
 * The classic 5×5 risk matrix HSE managers know: severity down the side
 * (5 at the top), likelihood across the bottom, cells coloured by band.
 * One click sets both likelihood and severity.
 *
 * Accessibility (feedback A-5): both axes carry 1–5 tick labels, every
 * cell's aria-label + tooltip names its band in text (never colour
 * alone), the selected cell shows the band label inside it, and a text
 * summary of the selection sits under the grid.
 *
 * `maxScore` (feedback P-1): cells scoring above it are disabled — the
 * residual picker passes the initial score so controls can never
 * "increase" risk.
 */
export function MatrixPicker({
  label,
  likelihood,
  severity,
  matrix,
  disabled,
  disabledHint,
  maxScore,
  onPick,
}: {
  label: string;
  likelihood: number | null;
  severity: number | null;
  matrix: MatrixThresholds;
  disabled: boolean;
  /** Shown under the grid when the whole picker is disabled. */
  disabledHint?: string | undefined;
  /** Cells with likelihood × severity above this are not selectable. */
  maxScore?: number | null | undefined;
  onPick: (likelihood: number, severity: number) => void;
}) {
  const t = useTranslations('riskAssessments');
  const selectedBand = bandFor(likelihood, severity, matrix);
  const cap = maxScore ?? null;
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium">{label}</span>
      <div className="flex items-end gap-1">
        <span
          className="pb-8 text-[10px] text-muted-foreground [writing-mode:vertical-rl] rotate-180"
          aria-hidden="true"
        >
          {t('hazards.severity')}
        </span>
        <div>
          <div
            className="grid grid-cols-[auto_repeat(5,minmax(0,1fr))] gap-0.5"
            role="group"
            aria-label={label}
          >
            {[...STEPS].reverse().map((s) => (
              <div key={`row-${s}`} className="contents">
                <span
                  className="flex w-4 items-center justify-center text-[10px] text-muted-foreground"
                  aria-hidden="true"
                >
                  {s}
                </span>
                {STEPS.map((l) => {
                  const cellScore = l * s;
                  const selected = likelihood === l && severity === s;
                  const band = bandFor(l, s, matrix);
                  const bandLabel = t(`band.${band}`);
                  const overCap = cap !== null && cellScore > cap;
                  const cellDisabled = disabled || overCap;
                  return (
                    <button
                      key={`${l}-${s}`}
                      type="button"
                      disabled={cellDisabled}
                      onClick={() => onPick(l, s)}
                      aria-pressed={selected}
                      aria-label={`${t('hazards.likelihood')} ${l} × ${t('hazards.severity')} ${s} = ${cellScore} — ${bandLabel}${overCap ? ` (${t('matrix.aboveInitial')})` : ''}`}
                      title={
                        overCap
                          ? `${cellScore} · ${t('matrix.aboveInitial')}`
                          : `${cellScore} · ${bandLabel}`
                      }
                      className={`flex h-9 w-10 flex-col items-center justify-center rounded-sm text-[11px] font-semibold leading-none transition-transform ${bandChipClasses(band)} ${
                        selected
                          ? 'ring-2 ring-foreground ring-offset-1 ring-offset-background scale-105'
                          : overCap
                            ? 'opacity-25'
                            : 'opacity-80 hover:opacity-100'
                      } ${cellDisabled ? 'cursor-not-allowed' : ''}`}
                    >
                      <span>{cellScore}</span>
                      {selected ? (
                        <span className="mt-0.5 text-[8px] font-medium uppercase tracking-wide">
                          {bandLabel}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
            <span aria-hidden="true" />
            {STEPS.map((l) => (
              <span
                key={`col-${l}`}
                className="pt-0.5 text-center text-[10px] text-muted-foreground"
                aria-hidden="true"
              >
                {l}
              </span>
            ))}
          </div>
          <p className="mt-0.5 text-center text-[10px] text-muted-foreground" aria-hidden="true">
            {t('hazards.likelihood')} →
          </p>
          <p className="text-xs" aria-live="polite">
            {likelihood !== null && severity !== null ? (
              <>
                <span className="text-muted-foreground">
                  {t('matrix.selectedSummary', {
                    likelihood,
                    severity,
                    score: likelihood * severity,
                  })}{' '}
                </span>
                <span
                  className={`rounded-full px-1.5 py-0.5 font-medium ${bandChipClasses(selectedBand)}`}
                >
                  {t(`band.${selectedBand}`)}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">{t('matrix.notSelected')}</span>
            )}
          </p>
          {disabled && disabledHint !== undefined ? (
            <p className="mt-1 max-w-56 text-[11px] text-muted-foreground">{disabledHint}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
