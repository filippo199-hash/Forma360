'use client';

import { ChevronDown, ChevronRight, FolderCog, ImageIcon, Plus, QrCode } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';

type AssetRow = {
  id: string;
  name: string;
  parentId: string | null;
  photoKey: string | null;
  typeId: string | null;
  typeName: string | null;
  siteId: string | null;
  qrToken: string | null;
  updatedAt: Date;
  archivedAt: Date | null;
};

export default function AssetsListPage() {
  const t = useTranslations('assets.list');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('assets.manage');

  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const { data: typesData } = trpc.assetTypes.list.useQuery({});
  const types = typesData ?? [];

  const { data, isLoading } = trpc.assets.list.useQuery({
    typeId: typeFilter === 'all' ? undefined : typeFilter,
    includeArchived,
  });
  const allRows = (data ?? []) as AssetRow[];

  // Split into top-level parents and children
  const parentRows = allRows.filter((r) => r.parentId === null);
  const childMap = new Map<string, AssetRow[]>();
  for (const r of allRows) {
    if (r.parentId !== null) {
      const bucket = childMap.get(r.parentId) ?? [];
      bucket.push(r);
      childMap.set(r.parentId, bucket);
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderRow(row: AssetRow, isChild: boolean): ReactNode {
    const children = childMap.get(row.id) ?? [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(row.id);

    return (
      <>
        <tr
          key={row.id}
          className={`border-b last:border-0 hover:bg-muted/30 ${row.archivedAt !== null ? 'opacity-60' : ''}`}
        >
          {/* Thumbnail */}
          <td className="px-3 py-2">
            <div className={isChild ? 'ml-8' : undefined}>
              {row.photoKey !== null ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/files?key=${encodeURIComponent(row.photoKey)}`}
                  alt=""
                  className="h-9 w-9 rounded-md object-cover"
                />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
            </div>
          </td>

          {/* Name with expand toggle */}
          <td className="px-3 py-2 font-medium">
            <div className={`flex items-center gap-1 ${isChild ? 'ml-8' : ''}`}>
              {!isChild && hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggleExpand(row.id)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              ) : (
                !isChild && <span className="w-5 shrink-0" />
              )}

              <Link href={`/${locale}/assets/${row.id}`} className="hover:underline">
                {row.name}
              </Link>

              {!isChild && hasChildren && (
                <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {children.length}
                </span>
              )}
            </div>
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
            {row.updatedAt.toLocaleDateString()}
          </td>
        </tr>

        {/* Children — rendered inline when expanded */}
        {!isChild && isExpanded && children.map((child) => renderRow(child, true))}
      </>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage ? (
            <Button variant="outline" asChild>
              <Link href={`/${locale}/assets/categories`}>
                <FolderCog className="mr-1 h-4 w-4" />
                {t('categoriesButton')}
              </Link>
            </Button>
          ) : null}
          {canManage ? (
            <Button asChild>
              <Link href={`/${locale}/assets/new`}>
                <Plus className="mr-1 h-4 w-4" />
                {t('newButton')}
              </Link>
            </Button>
          ) : null}
        </div>
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
      ) : parentRows.length === 0 ? (
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
                  <th className="w-12 px-3 py-2" />
                  <th className="px-3 py-2 font-medium">{t('columns.name')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.type')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.site')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.qr')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.updatedAt')}</th>
                </tr>
              </thead>
              <tbody>{parentRows.map((row) => renderRow(row, false))}</tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
