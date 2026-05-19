'use client';

import { Plus, QrCode } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';

export default function AssetsListPage() {
  const t = useTranslations('assets.list');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('assets.manage');

  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [includeArchived, setIncludeArchived] = useState(false);

  const { data: typesData } = trpc.assetTypes.list.useQuery({});
  const types = typesData ?? [];

  const { data, isLoading } = trpc.assets.list.useQuery({
    typeId: typeFilter === 'all' ? undefined : typeFilter,
    includeArchived,
  });
  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canManage ? (
          <Button asChild>
            <Link href={`/${locale}/assets/new`}>
              <Plus className="mr-1 h-4 w-4" />
              {t('newButton')}
            </Link>
          </Button>
        ) : null}
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label htmlFor="type-filter" className="text-xs font-medium text-muted-foreground">
            {t('filterType')}
          </label>
          <select
            id="type-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="block rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="all">{t('filterTypeAll')}</option>
            {types.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.name}
              </option>
            ))}
          </select>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="h-4 w-4"
          />
          {t('showArchived')}
        </label>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>{t('empty')}</p>
            {canManage ? (
              <Link
                href={`/${locale}/assets/new`}
                className="mt-2 inline-block text-foreground underline-offset-4 hover:underline"
              >
                {t('emptyCta')}
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">{t('columns.name')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.type')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.site')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.qr')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.updatedAt')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-b last:border-0 hover:bg-muted/30 ${row.archivedAt !== null ? 'opacity-60' : ''}`}
                  >
                    <td className="px-3 py-2 font-medium">
                      <Link
                        href={`/${locale}/assets/${row.id}`}
                        className="hover:underline"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.typeName ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.siteId ?? '—'}</td>
                    <td className="px-3 py-2">
                      {row.qrToken !== null ? (
                        <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                          <QrCode className="h-3 w-3" />
                          {row.qrToken}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(row.updatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
