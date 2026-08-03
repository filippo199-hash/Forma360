'use client';

/**
 * Status and state chips for the RAMS module (FreeHS B6).
 *
 * The briefing chip is the one that carries real meaning: "3 briefed on
 * v2" versus "briefed on a superseded version" is the difference between
 * a crew that may work and one that may not, so the superseded state is
 * styled as a warning rather than a neutral count.
 */
import { useTranslations } from 'next-intl';
import type { RamsPackStatus, RamsReviewOutcome } from '@forma360/shared/rams';

const BASE = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

const PACK_STATUS_CLASS: Record<RamsPackStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  issued: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100',
  superseded: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
  withdrawn: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
  cancelled: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

export function PackStatusChip({ status }: { status: RamsPackStatus }) {
  const t = useTranslations('rams.status');
  return <span className={`${BASE} ${PACK_STATUS_CLASS[status]}`}>{t(status)}</span>;
}

const REVIEW_OUTCOME_CLASS: Record<RamsReviewOutcome, string> = {
  pending: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
  accepted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100',
  accepted_with_conditions: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
};

export function ReviewOutcomeChip({ outcome }: { outcome: RamsReviewOutcome }) {
  const t = useTranslations('rams.reviewOutcome');
  return <span className={`${BASE} ${REVIEW_OUTCOME_CLASS[outcome]}`}>{t(outcome)}</span>;
}

/**
 * Briefing state against the pack's CURRENT version. `total` counts every
 * briefing ever recorded, so "0 on current, 4 total" is the re-issue
 * case — everyone must be briefed again.
 */
export function BriefingChip({
  onCurrent,
  currentVersion,
}: {
  onCurrent: number;
  currentVersion: number;
}) {
  const t = useTranslations('rams');
  if (currentVersion === 0) return null;
  const tone =
    onCurrent === 0
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100'
      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100';
  return (
    <span className={`${BASE} ${tone}`}>
      {t('briefedCount', { count: onCurrent, version: currentVersion })}
    </span>
  );
}

/** The client's decision on the issued pack, when a link has been sent. */
export function ClientDecisionChip({ decision }: { decision: string }) {
  const t = useTranslations('rams.clientDecision');
  const tone =
    decision === 'accepted'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100'
      : decision === 'changes_requested'
        ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
  const key = decision === 'accepted' || decision === 'changes_requested' ? decision : 'pending';
  return <span className={`${BASE} ${tone}`}>{t(key)}</span>;
}

/** A hold point on a step — the thing that makes it a system of work. */
export function HoldPointChip() {
  const t = useTranslations('rams');
  return (
    <span className={`${BASE} bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100`}>
      {t('holdPoint')}
    </span>
  );
}
