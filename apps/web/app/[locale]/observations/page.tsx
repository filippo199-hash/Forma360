'use client';

import type { IssueStatusValue } from '@forma360/shared/issues-schema';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ObservationDetailPanel } from '../../../src/components/observations/observation-detail-panel';
import { Sheet, SheetContent } from '../../../src/components/ui/sheet';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';

type StatusFilter = 'all' | IssueStatusValue;
const STATUSES: readonly StatusFilter[] = ['all', 'open', 'investigation', 'closed'];

/**
 * Observations list. Filterable by status / category / site / archived.
 * Cursor pagination via `nextCursor`. Hides "Report observation" +
 * "Manage categories" buttons for users without the relevant permissions
 * (server still enforces). The backend tRPC namespace is still
 * `trpc.issues.*` — the rename is UI-only.
 */
export default function ObservationsListPage() {
  const t = useTranslations('issues.list');
  const tStatus = useTranslations('issues.status');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  const canReport = useHasPermission('issues.report');
  const canManageSettings = useHasPermission('issues.settings');

  const [selectedObservationId, setSelectedObservationId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('observation');
  });

  function handleSelectObservation(id: string) {
    setSelectedObservationId(id);
    window.history.pushState(null, '', `/${locale}/observations?observation=${id}`);
  }

  function handleClosePanel() {
    setSelectedObservationId(null);
    window.history.pushState(null, '', `/${locale}/observations`);
  }

  const [status, setStatus] = useState<StatusFilter>('all');
  const [categoryId, setCategoryId] = useState<string>('');
  const [siteId, setSiteId] = useState<string>('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [pages, setPages] = useState<string[]>([]);

  const currentCursor = pages.length === 0 ? undefined : pages[pages.length - 1];

  const listInput: {
    status?: IssueStatusValue;
    categoryId?: string;
    siteId?: string;
    includeArchived: boolean;
    cursor?: string;
  } = { includeArchived };
  if (status !== 'all') listInput.status = status;
  if (categoryId !== '') listInput.categoryId = categoryId;
  if (siteId !== '') listInput.siteId = siteId;
  if (currentCursor !== undefined) listInput.cursor = currentCursor;

  const { data, isLoading } = trpc.issues.issues.list.useQuery(listInput);
  const { data: categories } = trpc.issues.categories.list.useQuery({ includeArchived: true });
  const { data: sites } = trpc.sites.list.useQuery();

  function resetPagination() {
    setPages([]);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {canManageSettings ? (
            <Button asChild variant="outline">
              <Link href={`/${locale}/observations/categories`}>{t('manageCategoriesButton')}</Link>
            </Button>
          ) : null}
          {canReport ? (
            <Button asChild>
              <Link href={`/${locale}/observations/new`}>{t('newButton')}</Link>
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="filter-status" className="text-xs font-medium text-muted-foreground">
            {t('filterStatus')}
          </label>
          <select
            id="filter-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              resetPagination();
            }}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? t('filterStatusAll') : tStatus(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="filter-category" className="text-xs font-medium text-muted-foreground">
            {t('filterCategory')}
          </label>
          <select
            id="filter-category"
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              resetPagination();
            }}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">{t('filterCategoryAll')}</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="filter-site" className="text-xs font-medium text-muted-foreground">
            {t('filterSite')}
          </label>
          <select
            id="filter-site"
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              resetPagination();
            }}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">{t('filterSiteAll')}</option>
            {(sites ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => {
              setIncludeArchived(e.target.checked);
              resetPagination();
            }}
            className="h-4 w-4"
          />
          <span>{t('showArchived')}</span>
        </label>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">{t('columns.reference')}</th>
                <th className="px-3 py-2 font-medium">{t('columns.title')}</th>
                <th className="px-3 py-2 font-medium">{t('columns.category')}</th>
                <th className="px-3 py-2 font-medium">{t('columns.site')}</th>
                <th className="px-3 py-2 font-medium">{t('columns.status')}</th>
                <th className="px-3 py-2 font-medium">{t('columns.created')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-4">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ) : (data?.items ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    <div>{t('empty')}</div>
                    {canReport ? (
                      <Link
                        href={`/${locale}/observations/new`}
                        className="mt-2 inline-block text-primary hover:underline"
                      >
                        {t('emptyCta')}
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ) : (
                (data?.items ?? []).map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                    onClick={() => handleSelectObservation(row.id)}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {row.referenceNumber}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{row.title}</span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.categorySnapshot.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.siteId !== null
                        ? ((sites ?? []).find((s) => s.id === row.siteId)?.name ?? '—')
                        : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <ObservationStatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatRelative(row.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          disabled={pages.length === 0}
          onClick={() => setPages((p) => p.slice(0, -1))}
        >
          {tCommon('back')}
        </Button>
        {data !== undefined && data.nextCursor !== null && data.nextCursor !== undefined ? (
          <LoadMoreButton
            cursor={data.nextCursor}
            label={t('loadMore')}
            onSelect={(next) => setPages((p) => [...p, next])}
          />
        ) : null}
      </div>

      {/* Observation detail sidebar */}
      <Sheet
        open={selectedObservationId !== null}
        onOpenChange={(open) => { if (!open) handleClosePanel(); }}
      >
        <SheetContent className="w-full p-0 sm:max-w-2xl" side="right">
          {selectedObservationId !== null ? (
            <ObservationDetailPanel observationId={selectedObservationId} locale={locale} />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function LoadMoreButton({
  cursor,
  label,
  onSelect,
}: {
  cursor: string;
  label: string;
  onSelect: (cursor: string) => void;
}) {
  return (
    <Button type="button" variant="outline" onClick={() => onSelect(cursor)}>
      {label}
    </Button>
  );
}

function ObservationStatusBadge({ status }: { status: string }) {
  const t = useTranslations('issues.status');
  const normalised: IssueStatusValue =
    status === 'open' || status === 'investigation' || status === 'closed'
      ? (status as IssueStatusValue)
      : 'open';
  const colors: Record<IssueStatusValue, string> = {
    open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
    investigation: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
    closed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${colors[normalised]}`}>
      {t(normalised)}
    </span>
  );
}

function formatRelative(d: Date | string): string {
  const ms = Date.now() - new Date(d).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
