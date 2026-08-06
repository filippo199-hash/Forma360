'use client';

/**
 * The report chooser (navigation review, recommendation 4).
 *
 * "Observations" and "Incidents" are genuinely ambiguous to someone who
 * has never been trained on this product, and they sit next to each
 * other in the menu. A porter who has just been assaulted should not
 * have to know the platform's taxonomy — and picking wrong sends a
 * serious injury down the hazard path, where nobody is alerted.
 *
 * So the decision is made here, in the flow, by the only question that
 * actually separates them: was anyone harmed? Whichever way it is
 * answered, the reporter lands on a form that fits what happened. The
 * menu never has to be where that judgement gets made.
 */
import { AlertTriangle, ChevronRight, Siren } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { brandHasModule } from '@forma360/shared/brand';
import { activeBrand } from '../../../src/lib/brand';
import { Card, CardContent } from '../../../src/components/ui/card';
import { useHasPermission } from '../../../src/lib/permissions-context';

export default function ReportChooserPage() {
  const t = useTranslations('reportChooser');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  const canReportHazard = useHasPermission('issues.report');
  const canReportIncident =
    useHasPermission('incidents.report') && brandHasModule(activeBrand.id, 'incidents');

  const choices = [
    ...(canReportIncident
      ? [
          {
            key: 'harmed',
            href: `/${locale}/incidents/new`,
            Icon: Siren,
            tone: 'border-red-300 dark:border-red-900',
          },
        ]
      : []),
    ...(canReportHazard
      ? [
          {
            key: 'noHarm',
            href: `/${locale}/observations/new`,
            Icon: AlertTriangle,
            tone: 'border-amber-300 dark:border-amber-900',
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {choices.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {t('noPermission')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {choices.map(({ key, href, Icon, tone }) => (
            <Link
              key={key}
              href={href}
              className={`flex items-center gap-4 rounded-lg border-2 p-5 transition-colors hover:bg-muted/50 ${tone}`}
            >
              <Icon className="h-7 w-7 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t(`${key}.label` as never)}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  {t(`${key}.hint` as never)}
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          ))}
          <p className="pt-2 text-xs text-muted-foreground">{t('footnote')}</p>
        </div>
      )}
    </div>
  );
}
