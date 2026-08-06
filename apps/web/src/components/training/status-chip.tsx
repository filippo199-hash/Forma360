'use client';

/**
 * Status presentation for the training matrix (FreeHS B7).
 *
 * Every status is rendered as **glyph + colour + text**, never colour
 * alone. That is Bello's accessibility point and it is not decoration: at
 * 120,000 cells, a colour-blind reviewer with no glyphs has no matrix at
 * all. The grid uses {@link StatusGlyph} where there is no room for
 * words, but the glyph itself still distinguishes every state, and each
 * cell carries a `title` with the full label.
 */
import { useTranslations } from 'next-intl';
import { TRAINING_STATUS_GLYPH, type TrainingStatus } from '@forma360/shared/training';
import { cn } from '../../lib/cn';

const CHIP_CLASS: Record<TrainingStatus, string> = {
  in_date:
    'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100',
  expiring_soon:
    'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
  expired:
    'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100',
  not_held:
    'border-slate-300 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-100',
  not_required: 'border-transparent bg-transparent text-muted-foreground',
};

const GLYPH_CLASS: Record<TrainingStatus, string> = {
  in_date: 'text-emerald-600 dark:text-emerald-400',
  expiring_soon: 'text-amber-600 dark:text-amber-400',
  expired: 'text-red-600 dark:text-red-400',
  not_held: 'text-slate-500 dark:text-slate-400',
  not_required: 'text-muted-foreground/50',
};

export function StatusChip({ status }: { status: TrainingStatus }) {
  const t = useTranslations('training.status');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        CHIP_CLASS[status],
      )}
    >
      <span aria-hidden="true">{TRAINING_STATUS_GLYPH[status]}</span>
      {t(status)}
    </span>
  );
}

/**
 * The one-glyph cell for the grid. The label rides along as `title` and
 * as screen-reader text, so the meaning never depends on the colour.
 */
export function StatusGlyph({ status }: { status: TrainingStatus }) {
  const t = useTranslations('training.status');
  const label = t(status);
  return (
    <span className={cn('text-base leading-none', GLYPH_CLASS[status])} title={label}>
      <span aria-hidden="true">{TRAINING_STATUS_GLYPH[status]}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** The legend that makes the glyphs readable without learning them. */
export function StatusLegend() {
  const t = useTranslations('training.status');
  const statuses: TrainingStatus[] = [
    'in_date',
    'expiring_soon',
    'expired',
    'not_held',
    'not_required',
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {statuses.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={GLYPH_CLASS[s]} aria-hidden="true">
            {TRAINING_STATUS_GLYPH[s]}
          </span>
          {t(s)}
        </span>
      ))}
    </div>
  );
}
