'use client';

import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { cn } from '../../../../src/lib/cn';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

type MaintenanceStatus = 'awaiting_first_reading' | 'on_schedule' | 'approaching' | 'overdue';

const MAINTENANCE_STATUS_COLORS: Record<MaintenanceStatus, string> = {
  awaiting_first_reading: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
  on_schedule: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  approaching: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
  overdue: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-100',
};

type Tab = 'overview' | 'readings' | 'maintenance';

export default function AssetDetailPage() {
  const t = useTranslations('assets.detail');
  const tMaint = useTranslations('maintenancePlans.table');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string; assetId: string }>();
  const locale = params.locale ?? 'en';
  const assetId = params.assetId ?? '';
  const utils = trpc.useUtils();

  const canManage = useHasPermission('assets.manage');
  const canRecord = useHasPermission('assets.readings.record');

  const [tab, setTab] = useState<Tab>('overview');
  const [readingFieldName, setReadingFieldName] = useState('');
  const [readingValue, setReadingValue] = useState('');
  const [readingUnit, setReadingUnit] = useState('');

  const { data, isLoading } = trpc.assets.get.useQuery({ assetId });
  const { data: readingsData } = trpc.assets.readings.list.useQuery(
    { assetId },
    { enabled: tab === 'readings' },
  );

  const { data: maintenanceData, isLoading: maintenanceLoading } =
    trpc.maintenancePlans.listForAsset.useQuery(
      { assetId },
      { enabled: tab === 'maintenance' },
    );

  const addReading = trpc.assets.readings.add.useMutation({
    onSuccess: () => {
      toast.success(t('readingAddedToast'));
      setReadingFieldName('');
      setReadingValue('');
      setReadingUnit('');
      void utils.assets.readings.list.invalidate({ assetId });
      void utils.assets.get.invalidate({ assetId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const archive = trpc.assets.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archiveToast'));
      void utils.assets.get.invalidate({ assetId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const restore = trpc.assets.restore.useMutation({
    onSuccess: () => {
      toast.success(t('restoreToast'));
      void utils.assets.get.invalidate({ assetId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  if (isLoading || data === undefined) {
    return <Skeleton className="m-6 h-96 w-full" />;
  }

  const { asset, assetType, childrenCount, latestReadings } = data;
  const isArchived = asset.archivedAt !== null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/assets`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{asset.name}</h1>
              {isArchived ? (
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {t('archivedBadge')}
                </span>
              ) : null}
              {assetType !== null ? (
                <span className="rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground">
                  {assetType.name}
                </span>
              ) : null}
            </div>
            {asset.qrToken !== null ? (
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {t('qrLabel')}: {asset.qrToken}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {canManage ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (isArchived) restore.mutate({ assetId });
                  else archive.mutate({ assetId });
                }}
                disabled={archive.isPending || restore.isPending}
              >
                {isArchived ? tCommon('restore' as never) : tCommon('archive')}
              </Button>
            ) : null}
          </div>
        </div>

        <nav className="flex gap-1 border-b">
          {(['overview', 'readings', 'maintenance'] as const).map((t_) => (
            <TabButton
              key={t_}
              active={tab === t_}
              onClick={() => setTab(t_)}
              label={t(`tabs.${t_}`)}
            />
          ))}
        </nav>
      </header>

      {tab === 'overview' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="space-y-3 p-6 text-sm">
              <h2 className="text-base font-semibold">{t('detailsHeading')}</h2>
              <DetailRow label={t('fields.type')}>{assetType?.name ?? '—'}</DetailRow>
              <DetailRow label={t('fields.site')}>{asset.siteId ?? '—'}</DetailRow>
              {asset.parentId !== null ? (
                <DetailRow label={t('fields.parent')}>
                  <Link
                    href={`/${locale}/assets/${asset.parentId}`}
                    className="hover:underline"
                  >
                    {asset.parentId.slice(-8)}
                  </Link>
                </DetailRow>
              ) : null}
              <DetailRow label={t('fields.children')}>{String(childrenCount)}</DetailRow>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-6 text-sm">
              <h2 className="text-base font-semibold">{t('latestReadingsHeading')}</h2>
              {latestReadings.length === 0 ? (
                <p className="text-muted-foreground">{t('noReadings')}</p>
              ) : (
                latestReadings.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0"
                  >
                    <span className="font-medium">{r.fieldName}</span>
                    <span>
                      {r.value} {r.unit}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'readings' ? (
        <div className="space-y-4">
          {canRecord && !isArchived ? (
            <Card>
              <CardContent className="p-6">
                <h2 className="mb-4 text-base font-semibold">{t('addReadingHeading')}</h2>
                <div className="flex flex-wrap gap-3">
                  <Input
                    placeholder={t('readingFieldNamePlaceholder')}
                    value={readingFieldName}
                    onChange={(e) => setReadingFieldName(e.target.value)}
                    maxLength={200}
                    className="w-40"
                  />
                  <Input
                    type="number"
                    placeholder={t('readingValuePlaceholder')}
                    value={readingValue}
                    onChange={(e) => setReadingValue(e.target.value)}
                    className="w-32"
                  />
                  <Input
                    placeholder={t('readingUnitPlaceholder')}
                    value={readingUnit}
                    onChange={(e) => setReadingUnit(e.target.value)}
                    maxLength={50}
                    className="w-24"
                  />
                  <Button
                    type="button"
                    disabled={
                      addReading.isPending ||
                      readingFieldName.trim().length === 0 ||
                      readingValue === ''
                    }
                    onClick={() =>
                      addReading.mutate({
                        assetId,
                        fieldName: readingFieldName.trim(),
                        value: Number(readingValue),
                        unit: readingUnit.trim(),
                        source: 'manual',
                      })
                    }
                  >
                    {t('addReadingButton')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">{t('readingColumns.field')}</th>
                    <th className="px-3 py-2 font-medium">{t('readingColumns.value')}</th>
                    <th className="px-3 py-2 font-medium">{t('readingColumns.source')}</th>
                    <th className="px-3 py-2 font-medium">{t('readingColumns.capturedAt')}</th>
                    <th className="px-3 py-2 font-medium">{t('readingColumns.capturedBy')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(readingsData ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground">
                        {t('noReadings')}
                      </td>
                    </tr>
                  ) : (
                    (readingsData ?? []).map((r) => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium">{r.fieldName}</td>
                        <td className="px-3 py-2">
                          {r.value} {r.unit}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{r.source}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {new Date(r.capturedAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {r.capturedByName ?? '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'maintenance' ? (
        <div className="space-y-4">
          {maintenanceLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (maintenanceData ?? []).length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <p>{t('maintenancePlans.empty')}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">{t('maintenancePlans.columns.plan')}</th>
                      <th className="px-3 py-2 font-medium">{t('maintenancePlans.columns.type')}</th>
                      <th className="px-3 py-2 font-medium">{t('maintenancePlans.columns.lastService')}</th>
                      <th className="px-3 py-2 font-medium">{t('maintenancePlans.columns.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(maintenanceData ?? []).map((row) => {
                      const status = row.status as MaintenanceStatus;
                      return (
                        <tr key={row.planId ?? row.lastServiceDate} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">{row.planName ?? '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {tMaint(`planType.${row.planType ?? 'time'}`)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {row.lastServiceDate ?? '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${MAINTENANCE_STATUS_COLORS[status] ?? MAINTENANCE_STATUS_COLORS.on_schedule}`}
                            >
                              {tMaint(`status.${status}`)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-b-2 -mb-px px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[110px_1fr]">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}
