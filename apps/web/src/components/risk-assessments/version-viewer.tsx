'use client';

import { useLocale, useTranslations } from 'next-intl';
import { bandFor, scoreFor } from '../../lib/risk-matrix';
import { trpc } from '../../lib/trpc/client';
import { formatDate } from '../../lib/format-date';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Skeleton } from '../ui/skeleton';

/**
 * Read-only viewer for one frozen published version — "the assessment as
 * in force on {date}" (feedback M-3). Renders straight from the immutable
 * snapshot, never from the live rows, so what the auditor sees is exactly
 * what was signed.
 */
export function VersionViewer({
  assessmentId,
  versionNumber,
  open,
  onOpenChange,
}: {
  assessmentId: string;
  versionNumber: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('riskAssessments');
  const locale = useLocale();
  const query = trpc.riskAssessments.getVersion.useQuery(
    { assessmentId, versionNumber: versionNumber ?? 1 },
    { enabled: open && versionNumber !== null },
  );
  const version = query.data?.version;
  const content = version?.content;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {versionNumber !== null ? t('versions.viewerTitle', { version: versionNumber }) : ''}
          </DialogTitle>
        </DialogHeader>
        {query.isLoading || content === undefined || version === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-base font-semibold">{content.title}</p>
              <p className="text-xs text-muted-foreground">
                {t(`type.${content.type}`)}
                {content.siteName !== null ? ` · ${content.siteName}` : ''}
                {content.locationText !== null && content.locationText.length > 0
                  ? ` · ${content.locationText}`
                  : ''}
              </p>
              {content.activity.length > 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">{content.activity}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              {content.hazards.map((h, i) => {
                const initial = scoreFor(h.initialLikelihood, h.initialSeverity);
                const residual = scoreFor(h.residualLikelihood, h.residualSeverity);
                const initialBand = bandFor(h.initialLikelihood, h.initialSeverity, content.matrix);
                const residualBand = bandFor(
                  h.residualLikelihood,
                  h.residualSeverity,
                  content.matrix,
                );
                return (
                  <div key={i} className="rounded-md border p-3">
                    <p className="font-medium">
                      {h.hazard}
                      {h.harmDescription.length > 0 ? (
                        <span className="font-normal text-muted-foreground">
                          {' '}
                          — {h.harmDescription}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('hazards.initialRisk')}:{' '}
                      {initial !== null ? `${initial} (${t(`band.${initialBand}`)})` : '—'}
                      {' · '}
                      {t('hazards.residualRisk')}:{' '}
                      {residual !== null ? `${residual} (${t(`band.${residualBand}`)})` : '—'}
                    </p>
                    {h.existingControls.length > 0 ? (
                      <p className="mt-1 text-xs">{h.existingControls}</p>
                    ) : null}
                    {h.controls.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {h.controls.map((c, j) => (
                          <li key={j}>
                            <span className="rounded bg-muted px-1 py-0.5">
                              {t(`controls.tier.${c.tier}`)}
                            </span>{' '}
                            {c.description}
                            {c.status === 'planned' ? ` (${t('controls.statusPlanned')})` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {h.residualJustification.length > 0 ? (
                      <p className="mt-1 text-xs italic text-muted-foreground">
                        {t('matrix.residualNoteLabel')}: {h.residualJustification}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <p className="border-t pt-2 text-xs text-muted-foreground">
              {t('versions.signOffLine', {
                name: version.signedOffByName ?? version.signedOffBy,
                date: formatDate(version.signedOffAt, locale),
              })}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
