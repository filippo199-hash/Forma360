'use client';

/**
 * Small shared chips for the Fire Safety module: check due status, FRA
 * lifecycle status, statutory-duty badges, check/inspection results and
 * marshal training state. Kept together — they're all one-line
 * presentational pieces the hub, building record, logbook and FRA
 * editor share.
 */
import { useTranslations } from 'next-intl';
import { cn } from '../../lib/cn';

const CHIP_BASE =
  'inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap';

/**
 * failed / ok / due_soon / overdue — the calendar's traffic light.
 * 'failed' (HSE review FS-1) is the loudest state: the last recorded
 * result was a FAIL and only a passing re-test clears it.
 */
export function DueStatusChip({
  status,
}: {
  status: 'ok' | 'due_soon' | 'overdue' | 'failed' | 'not_yet_done';
}) {
  const t = useTranslations('fireSafety.dueStatus');
  return (
    <span
      className={cn(
        CHIP_BASE,
        status === 'failed' &&
          'border-red-600 bg-red-600 text-white dark:border-red-500 dark:bg-red-600',
        status === 'overdue' &&
          'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
        status === 'due_soon' &&
          'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
        status === 'ok' &&
          'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
        // UXW4-03: never-logged — neutral, not green; "OK" asserted an
        // inspection nobody had made.
        status === 'not_yet_done' && 'border-muted bg-muted text-muted-foreground',
      )}
    >
      {t(status)}
    </span>
  );
}

export function FraStatusChip({ status }: { status: 'draft' | 'active' | 'archived' }) {
  const t = useTranslations('fireSafety.fraStatus');
  return (
    <span
      className={cn(
        CHIP_BASE,
        status === 'active' &&
          'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
        status === 'draft' &&
          'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300',
        status === 'archived' &&
          'border-slate-300 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400',
      )}
    >
      {t(status)}
    </span>
  );
}

/**
 * Statutory-duty badges from the building profile — the loud ones. A
 * high-rise residential building carries the 2022 Regulations duties;
 * above-11-metre residential carries the door-check regime.
 */
export function DutyBadges({
  duty,
}: {
  duty: { highRiseResidential: boolean; above11mResidential: boolean };
}) {
  const t = useTranslations('fireSafety.duty');
  if (!duty.highRiseResidential && !duty.above11mResidential) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {duty.highRiseResidential ? (
        <span
          className={cn(
            CHIP_BASE,
            'border-purple-300 bg-purple-50 text-purple-900 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-200',
          )}
        >
          {t('highRise')}
        </span>
      ) : (
        <span
          className={cn(
            CHIP_BASE,
            'border-indigo-300 bg-indigo-50 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200',
          )}
        >
          {t('above11m')}
        </span>
      )}
    </span>
  );
}

/** pass / defects_found / fail — logbook entries and door inspections. */
export function ResultChip({ result }: { result: 'pass' | 'defects_found' | 'fail' }) {
  const t = useTranslations('fireSafety.results');
  return (
    <span
      className={cn(
        CHIP_BASE,
        result === 'pass' &&
          'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
        result === 'defects_found' &&
          'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
        result === 'fail' &&
          'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
      )}
    >
      {t(result)}
    </span>
  );
}

export function TrainingStatusChip({
  status,
}: {
  status: 'not_trained' | 'in_date' | 'expiring_soon' | 'expired';
}) {
  const t = useTranslations('fireSafety.trainingStatus');
  return (
    <span
      className={cn(
        CHIP_BASE,
        status === 'in_date' &&
          'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
        status === 'expiring_soon' &&
          'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
        (status === 'expired' || status === 'not_trained') &&
          'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
      )}
    >
      {t(status)}
    </span>
  );
}

export function RiskRatingChip({
  rating,
}: {
  rating: 'trivial' | 'tolerable' | 'moderate' | 'substantial' | 'intolerable' | null;
}) {
  const t = useTranslations('fireSafety.riskRatings');
  if (rating === null) return null;
  return (
    <span
      className={cn(
        CHIP_BASE,
        (rating === 'trivial' || rating === 'tolerable') &&
          'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
        rating === 'moderate' &&
          'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
        (rating === 'substantial' || rating === 'intolerable') &&
          'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
      )}
    >
      {t(rating)}
    </span>
  );
}
