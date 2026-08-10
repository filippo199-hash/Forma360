'use client';

/**
 * G3 — the standard footer under a register's table: the results count,
 * bottom-right, with a small download icon beside it. The count moved here
 * from the top of the table (it used to sit on the FilterBar). The download
 * icon (tooltip "Download these results") exports the current results as a
 * CSV; it is only shown when the caller supplies `onDownloadCsv`.
 */
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { TooltipIconButton } from './ui/tooltip-icon-button';

export function ResultsFooter({
  count,
  onDownloadCsv,
}: {
  count: number;
  /** When provided, renders the CSV download icon. */
  onDownloadCsv?: () => void;
}) {
  const t = useTranslations('common');
  return (
    <div className="mt-3 flex items-center justify-end gap-1 text-xs text-muted-foreground">
      <span>{t('resultsCount', { count })}</span>
      {onDownloadCsv !== undefined ? (
        <TooltipIconButton
          icon={Download}
          label={t('downloadResults')}
          onClick={onDownloadCsv}
        />
      ) : null}
    </div>
  );
}
