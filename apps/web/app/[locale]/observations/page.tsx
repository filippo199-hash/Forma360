'use client';

import type { IssueStatusValue } from '@forma360/shared/issues-schema';
import { Tags } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ObservationDetailPanel } from '../../../src/components/observations/observation-detail-panel';
import { SiteFilterChip, useSiteFilterParam } from '../../../src/components/site-filter-chip';
import { Sheet, SheetContent } from '../../../src/components/ui/sheet';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { usePlaceTerms } from '../../../src/lib/terminology';
import { relativeTime } from '../../../src/lib/relative-time';
import { trpc } from '../../../src/lib/trpc/client';

type StatusFilter = 'all' | IssueStatusValue;
const STATUSES: readonly StatusFilter[] = ['all', 'open', 'investigation', 'closed'];

interface ObservationRowView {
  id: string;
  reference: string;
  title: string;
  categoryName: string;
  siteName: string;
  status: string;
  createdLabel: string;
  detailUrl: string;
}

/**
 * Per-row derived view-model shared by the desktop table and the mobile card
 * list so the "where does the row link / how is created rendered" logic lives
 * in one place (mirrors the inspections list's `deriveRowView`).
 */
function deriveObservationRow(
  row: {
    id: string;
    referenceNumber: string;
    title: string;
    categorySnapshot: { name: string };
    siteId: string | null;
    status: string;
    createdAt: Date | string;
  },
  sites: ReadonlyArray<{ id: string; name: string }> | undefined,
  locale: string,
): ObservationRowView {
  const siteName =
    row.siteId !== null ? ((sites ?? []).find((s) => s.id === row.siteId)?.name ?? '—') : '—';
  return {
    id: row.id,
    reference: row.referenceNumber,
    title: row.title,
    categoryName: row.categorySnapshot.name,
    siteName,
    status: row.status,
    createdLabel: relativeTime(row.createdAt, locale),
    detailUrl: `/${locale}/observations/${row.id}`,
  };
}

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
  const { label: placeLabel } = usePlaceTerms();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const canReport = useHasPermission('issues.report');
  const canManageSettings = useHasPermission('issues.settings');

  // The detail Sheet stays for `?observation=` deep links (site media gallery,
  // plans viewer, and overview all link in that way). Row clicks now navigate
  // to the full detail page — one predictable primary target per row.
  const [selectedObservationId, setSelectedObservationId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('observation');
  });

  function handleClosePanel() {
    setSelectedObservationId(null);
    window.history.pushState(null, '', `/${locale}/observations`);
  }

  const [status, setStatus] = useState<StatusFilter>('all');
  const [categoryId, setCategoryId] = useState<string>('');
  // ?site= deep links (from a project page) use the shared dismissible chip —
  // same pattern as inspections/actions/documents/assets. The dropdown covers
  // manual filtering and hides while the chip is active.
  const { siteId: siteParam, clear: clearSiteParam } = useSiteFilterParam();
  const [siteId, setSiteId] = useState<string>('');
  const effectiveSiteId = siteParam !== '' ? siteParam : siteId;
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
  if (effectiveSiteId !== '') listInput.siteId = effectiveSiteId;
  if (currentCursor !== undefined) listInput.cursor = currentCursor;

  const { data, isLoading } = trpc.issues.issues.list.useQuery(listInput);
  const { data: categories } = trpc.issues.categories.list.useQuery({ includeArchived: true });
  const { data: sites } = trpc.sites.list.useQuery();

  function resetPagination() {
    setPages([]);
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-4 sm:space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {canManageSettings ? (
            <Button
              asChild
              variant="outline"
              title={t('manageCategoriesButton')}
              className="w-10 px-0 sm:w-auto sm:px-4"
            >
              <Link href={`/${locale}/observations/categories`}>
                <Tags className="h-4 w-4" />
                <span className="hidden sm:inline">{t('manageCategoriesButton')}</span>
              </Link>
            </Button>
          ) : null}
          {canReport ? (
            <Button asChild>
              <Link href={`/${locale}/observations/new`}>{t('newButton')}</Link>
            </Button>
          ) : null}
        </div>
      </header>

      {siteParam !== '' ? <SiteFilterChip siteId={siteParam} onClear={clearSiteParam} /> : null}

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
        {siteParam === '' ? (
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="filter-site" className="text-xs font-medium text-muted-foreground">
              {placeLabel}
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
        ) : null}
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

      {/* Table (desktop) — the mobile card list below takes over under md. */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">{t('columns.reference')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.title')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.category')}</th>
                  <th className="px-3 py-2 font-medium">{placeLabel}</th>
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
                  (data?.items ?? []).map((row) => {
                    const view = deriveObservationRow(row, sites, locale);
                    return (
                      <tr
                        key={view.id}
                        className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                        onClick={() => router.push(view.detailUrl)}
                      >
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          <Link
                            href={view.detailUrl}
                            className="hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {view.reference}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={view.detailUrl}
                            className="font-medium hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {view.title}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{view.categoryName}</td>
                        <td className="px-3 py-2 text-muted-foreground">{view.siteName}</td>
                        <td className="px-3 py-2">
                          <ObservationStatusBadge status={view.status} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{view.createdLabel}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Card list (mobile) — stacked layout under md; the table is hidden there. */}
      <div className="space-y-3 md:hidden">
        {isLoading ? (
          <Card>
            <CardContent className="p-4">
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ) : (data?.items ?? []).length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <div>{t('empty')}</div>
              {canReport ? (
                <Link
                  href={`/${locale}/observations/new`}
                  className="mt-2 inline-block text-primary hover:underline"
                >
                  {t('emptyCta')}
                </Link>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          (data?.items ?? []).map((row) => {
            const view = deriveObservationRow(row, sites, locale);
            return (
              <Link key={view.id} href={view.detailUrl} className="block">
                <Card className="transition-colors hover:bg-muted/30">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 font-medium">{view.title}</p>
                      <ObservationStatusBadge status={view.status} />
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">{view.reference}</p>
                    <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <div>
                        <dt className="font-medium text-foreground">{t('columns.category')}</dt>
                        <dd className="truncate">{view.categoryName}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">{placeLabel}</dt>
                        <dd className="truncate">{view.siteName}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">{t('columns.created')}</dt>
                        <dd>{view.createdLabel}</dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              </Link>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          disabled={pages.length === 0}
          onClick={() => setPages((p) => p.slice(0, -1))}
        >
          {t('previousPage')}
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
        onOpenChange={(open) => {
          if (!open) handleClosePanel();
        }}
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
