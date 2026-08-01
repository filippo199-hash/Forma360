'use client';

import { useTranslations } from 'next-intl';
import { bandChipClasses, bandForScore, type MatrixThresholds } from '../../lib/risk-matrix';

const STEPS = [1, 2, 3, 4, 5] as const;

/**
 * The classic 5×5 risk matrix HSE managers know: severity down the side
 * (5 at the top), likelihood across the bottom axis, cells coloured by
 * band. One click sets both likelihood and severity.
 */
export function MatrixPicker({
  label,
  likelihood,
  severity,
  matrix,
  disabled,
  onPick,
}: {
  label: string;
  likelihood: number | null;
  severity: number | null;
  matrix: MatrixThresholds;
  disabled: boolean;
  onPick: (likelihood: number, severity: number) => void;
}) {
  const t = useTranslations('riskAssessments');
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium">{label}</span>
      <div className="flex items-end gap-1">
        <span
          className="pb-6 text-[10px] text-muted-foreground [writing-mode:vertical-rl] rotate-180"
          aria-hidden="true"
        >
          {t('hazards.severity')}
        </span>
        <div>
          <div className="grid grid-cols-5 gap-0.5" role="group" aria-label={label}>
            {[...STEPS].reverse().map((s) =>
              STEPS.map((l) => {
                const selected = likelihood === l && severity === s;
                const band = bandForScore(l * s, matrix);
                return (
                  <button
                    key={`${l}-${s}`}
                    type="button"
                    disabled={disabled}
                    onClick={() => onPick(l, s)}
                    aria-pressed={selected}
                    aria-label={`${t('hazards.likelihood')} ${l} × ${t('hazards.severity')} ${s}`}
                    className={`flex h-7 w-9 items-center justify-center rounded-sm text-[11px] font-medium transition-transform ${bandChipClasses(band)} ${
                      selected
                        ? 'ring-2 ring-foreground ring-offset-1 ring-offset-background scale-105'
                        : 'opacity-80 hover:opacity-100'
                    } ${disabled ? 'cursor-default' : ''}`}
                  >
                    {l * s}
                  </button>
                );
              }),
            )}
          </div>
          <p className="mt-0.5 text-center text-[10px] text-muted-foreground" aria-hidden="true">
            {t('hazards.likelihood')} →
          </p>
        </div>
      </div>
    </div>
  );
}
