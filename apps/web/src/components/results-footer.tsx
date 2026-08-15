'use client';

/**
 * G3 — the standard footer under a register's table: the results count,
 * bottom-right, with a small download icon beside it. The download icon
 * (tooltip "Download these results") exports the current results as a CSV;
 * it is only shown when the caller supplies `onDownloadCsv`.
 *
 * This is the ONLY place a register prints its result count. It used to sit
 * on the right of the FilterBar in most modules and under the table in two,
 * so the same number appeared above or below the rows depending on which
 * page you were on. The FilterBar no longer accepts a count at all — the
 * inconsistency is not reachable rather than merely discouraged.
 */
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { TooltipIconButton } from './ui/tooltip-icon-button';

export function ResultsFooter({
  count,
  suffix,
  onDownloadCsv,
}: {
  count: number;
  /**
   * Appended after the count — e.g. Inspections' " / {total}" while a
   * search narrows the page, or Training's "as at {date}".
   */
  suffix?: ReactNode;
  /** When provided, renders the CSV download icon. */
  onDownloadCsv?: () => void;
}) {
  const t = useTranslations('common');
  return (
    <div className="mt-3 flex items-center justify-end gap-1 text-xs text-muted-foreground">
      <span>
        {t('resultsCount', { count })}
        {suffix}
      </span>
      {onDownloadCsv !== undefined ? (
        <TooltipIconButton icon={Download} label={t('downloadResults')} onClick={onDownloadCsv} />
      ) : null}
    </div>
  );
}
