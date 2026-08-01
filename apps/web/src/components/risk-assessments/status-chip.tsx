'use client';

import { useTranslations } from 'next-intl';

export type RaStatus = 'draft' | 'active' | 'archived';

/**
 * Status colours follow the house convention: light blue for the live
 * state (Observations "open"), amber for drafts (Templates), muted for
 * archived.
 */
const STYLES: Record<RaStatus, string> = {
  active: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
  draft: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  archived: 'bg-muted text-muted-foreground',
};

/** Small coloured chip showing a risk assessment's lifecycle status. */
export function RaStatusChip({ status }: { status: RaStatus }) {
  const t = useTranslations('riskAssessments');
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {t(`status.${status}`)}
    </span>
  );
}
