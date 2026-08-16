'use client';

/**
 * Read-only viewer for one signed COSHH assessment version (BUG-03) —
 * "the assessment as attested on {date}".
 *
 * Renders EXCLUSIVELY from the frozen `coshh_assessment_versions.content`
 * snapshot, never from the live rows — a viewer that fell back to live data
 * would silently defeat the audit purpose of taking a version. Follows the
 * risk-assessments `VersionViewer` precedent.
 */
import { useLocale, useTranslations } from 'next-intl';
import { formatDate, formatDateTime } from '../../lib/format-date';
import { trpc } from '../../lib/trpc/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Skeleton } from '../ui/skeleton';

const TIERS = [
  'elimination',
  'substitution',
  'engineering',
  'administrative',
  'rpe',
  'ppe',
] as const;

const EXPOSED_PRESETS = [
  'employees',
  'cleaners',
  'contractors',
  'maintenance_staff',
  'young_persons',
  'new_expectant_mothers',
  'visitors',
  'members_of_public',
] as const;

export function CoshhVersionViewer({
  versionId,
  open,
  onOpenChange,
}: {
  versionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('coshh');
  const tEditor = useTranslations('coshh.editor');
  const locale = useLocale();
  const query = trpc.coshh.assessments.getVersion.useQuery(
    { versionId: versionId ?? '' },
    { enabled: open && versionId !== null },
  );
  const version = query.data;
  const content = version?.content;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {version !== undefined
              ? t('versions.viewerTitle', { version: version.versionNumber })
              : ''}
          </DialogTitle>
        </DialogHeader>
        {query.isLoading || content === undefined || version === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-base font-semibold">{content.taskDescription}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {content.referenceNumber ?? ''}
                {content.referenceNumber !== null ? ' · ' : ''}
                {content.substanceName}
                {' · '}
                {t(`kinds.${content.kind}` as never)}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{tEditor('routesLabel')}</p>
              <p>
                {content.routesOfExposure.length > 0
                  ? content.routesOfExposure.map((r) => t(`routes.${r}` as never)).join(', ')
                  : '—'}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{tEditor('personsLabel')}</p>
              <p>
                {content.personsExposed.length > 0
                  ? content.personsExposed
                      .map((g) =>
                        (EXPOSED_PRESETS as readonly string[]).includes(g)
                          ? t(`exposedGroups.${g}` as never)
                          : g,
                      )
                      .join(', ')
                  : '—'}
                {content.personsCount !== null
                  ? ` · ${tEditor('personsCountLabel')}: ${content.personsCount}`
                  : ''}
              </p>
            </div>

            <div className="grid gap-2 text-xs sm:grid-cols-3">
              <p>
                <span className="text-muted-foreground">{tEditor('quantityBandLabel')}: </span>
                {content.quantityBand !== null
                  ? t(`quantityBands.${content.quantityBand}` as never)
                  : '—'}
              </p>
              <p>
                <span className="text-muted-foreground">{tEditor('frequencyBandLabel')}: </span>
                {content.frequencyBand !== null
                  ? t(`frequencyBands.${content.frequencyBand}` as never)
                  : '—'}
              </p>
              <p>
                <span className="text-muted-foreground">{tEditor('durationBandLabel')}: </span>
                {content.durationBand !== null
                  ? t(`durationBands.${content.durationBand}` as never)
                  : '—'}
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {tEditor('controlsSection')}
              </p>
              {content.controls.length === 0 ? (
                <p className="text-xs text-muted-foreground">{tEditor('tierEmpty')}</p>
              ) : (
                <ul className="space-y-1">
                  {TIERS.flatMap((tier) =>
                    content.controls
                      .filter((c) => c.tier === tier)
                      .map((c, i) => (
                        <li key={`${tier}-${i}`} className="space-y-0.5">
                          <p className="flex items-center gap-2">
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">
                              {t(`tiers.${tier}` as never)}
                            </span>
                            <span className="min-w-0 flex-1">{c.description}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {c.status === 'planned'
                                ? tEditor('controlPlanned')
                                : tEditor('controlInPlace')}
                            </span>
                          </p>
                          {c.ppeJustification !== null && c.ppeJustification.trim() !== '' ? (
                            <p className="pl-2 text-xs text-muted-foreground">
                              {tEditor('justificationLabel')}: {c.ppeJustification}
                            </p>
                          ) : null}
                          {c.rpeType !== null || c.rpeApf !== null ? (
                            <p className="pl-2 text-xs text-muted-foreground">
                              {[
                                ...(c.rpeType !== null ? [c.rpeType] : []),
                                ...(c.rpeApf !== null
                                  ? [tEditor('rpe.apfValue', { apf: c.rpeApf })]
                                  : []),
                              ].join(' · ')}
                            </p>
                          ) : null}
                        </li>
                      )),
                  )}
                </ul>
              )}
            </div>

            {content.levRequired ||
            content.healthSurveillanceRequired ||
            content.exposureMonitoringRequired ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {tEditor('requirementsSection')}
                </p>
                <p className="text-xs">
                  {[
                    ...(content.levRequired ? [tEditor('requirements.levRequired')] : []),
                    ...(content.healthSurveillanceRequired
                      ? [tEditor('requirements.healthSurveillanceRequired')]
                      : []),
                    ...(content.exposureMonitoringRequired
                      ? [tEditor('requirements.exposureMonitoringRequired')]
                      : []),
                  ].join(' · ')}
                </p>
              </div>
            ) : null}

            {content.emergencyNotes.trim() !== '' ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {tEditor('emergencyLabel')}
                </p>
                <p className="whitespace-pre-wrap text-xs">{content.emergencyNotes}</p>
              </div>
            ) : null}

            {content.plainSummary.trim() !== '' ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {tEditor('summarySection')}
                </p>
                <p className="whitespace-pre-wrap text-xs">{content.plainSummary}</p>
              </div>
            ) : null}

            {content.reviewFrequencyMonths !== null || content.nextReviewAt !== null ? (
              <p className="text-xs text-muted-foreground">
                {content.reviewFrequencyMonths !== null
                  ? t('versions.reviewEvery', { count: content.reviewFrequencyMonths })
                  : ''}
                {content.reviewFrequencyMonths !== null && content.nextReviewAt !== null
                  ? ' · '
                  : ''}
                {content.nextReviewAt !== null
                  ? t('versions.nextReview', { date: formatDate(content.nextReviewAt, locale) })
                  : ''}
              </p>
            ) : null}

            <p className="border-t pt-2 text-xs text-muted-foreground">
              {t('versions.number', { version: version.versionNumber })}{' '}
              {t('versions.signedBy', {
                name: version.signedOffByName ?? version.signedOffBy,
                date: formatDateTime(version.signedOffAt, locale),
              })}
              {version.supersededAt !== null ? ` · ${t('versions.superseded')}` : ''}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
