'use client';

/**
 * The gap list — the module's landing view (FreeHS B7).
 *
 * Nair's design point, and the reason it leads rather than the grid:
 * *"Everyone pictures the grid. The grid matters — but I look at it once
 * a month. What I need on a Tuesday morning is the gap list: who is
 * missing what, sorted by how much it matters."* So the grid is the
 * second tab and this is the first, ordered expired → expiring → never
 * held, with every row one click from recording the fix.
 */
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { RecordDialog } from '../../../src/components/training/record-dialog';
import { StatusChip } from '../../../src/components/training/status-chip';
import { TrainingTabs } from '../../../src/components/training/training-tabs';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';

type GapRow = {
  personKey: string;
  personName: string;
  userId: string | null;
  requirementId: string;
  requirementName: string;
  expiresAt: Date | null;
};

export default function TrainingGapsPage() {
  const t = useTranslations('training');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canRecord = useHasPermission('training.record');
  const [prefill, setPrefill] = useState<GapRow | null>(null);

  const { data, isLoading } = trpc.training.gaps.useQuery({});

  const formatDate = (d: Date | null): string =>
    d === null ? '—' : new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  const sections: Array<{ key: 'expired' | 'expiringSoon' | 'notHeld'; rows: GapRow[] }> = [
    { key: 'expired', rows: data?.expired ?? [] },
    { key: 'expiringSoon', rows: data?.expiringSoon ?? [] },
    { key: 'notHeld', rows: data?.notHeld ?? [] },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <TrainingTabs activeTab="gaps" locale={locale} />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">{t('subtitle')}</p>
        </div>
        {canRecord ? (
          <Button onClick={() => setPrefill({} as GapRow)}>{t('record.title')}</Button>
        ) : null}
      </header>

      {/* Compliance is a moving number; a view without its date is meaningless. */}
      {data !== undefined ? (
        <p className="text-xs text-muted-foreground">
          {t('asAt', { date: new Date(data.asOf).toLocaleDateString(locale) })}
        </p>
      ) : null}

      {isLoading ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </CardContent>
        </Card>
      ) : (data?.total ?? 0) === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            {t('gaps.empty')}
          </CardContent>
        </Card>
      ) : (
        sections
          .filter((s) => s.rows.length > 0)
          .map((section) => (
            <section key={section.key} className="space-y-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <StatusChip
                  status={
                    section.key === 'expired'
                      ? 'expired'
                      : section.key === 'expiringSoon'
                        ? 'expiring_soon'
                        : 'not_held'
                  }
                />
                <span className="text-muted-foreground">{section.rows.length}</span>
              </h2>
              <Card>
                <CardContent className="p-0">
                  <ul className="divide-y">
                    {section.rows.map((row) => (
                      <li
                        key={`${row.personKey}-${row.requirementId}`}
                        className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{row.personName}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {row.requirementName}
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {section.key === 'notHeld'
                            ? t('gaps.requiredByRole')
                            : t('gaps.expiresOn', { date: formatDate(row.expiresAt) })}
                        </span>
                        {canRecord ? (
                          <Button size="sm" variant="outline" onClick={() => setPrefill(row)}>
                            {t('gaps.record')}
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </section>
          ))
      )}

      <RecordDialog
        open={prefill !== null}
        onOpenChange={(v) => {
          if (!v) setPrefill(null);
        }}
        prefill={
          prefill !== null && prefill.requirementId !== undefined
            ? {
                requirementId: prefill.requirementId,
                personName: prefill.personName,
                userId: prefill.userId,
              }
            : undefined
        }
      />
    </div>
  );
}
