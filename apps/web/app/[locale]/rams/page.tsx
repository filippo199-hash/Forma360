'use client';

/**
 * RAMS register — the module home.
 *
 * Leads with the needs-attention strip: packs sitting in draft, issued
 * packs nobody has been briefed on, client acceptances still pending,
 * and third-party reviews awaiting a decision or about to expire. Each
 * chip applies the matching filter on click, so the strip is navigation
 * rather than decoration. The list mirrors the permits and incidents
 * registers: filter row, desktop table, mobile cards.
 */
import { Download, FolderOpen, Plus, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { RAMS_PACK_STATUSES, type RamsPackStatus } from '@forma360/shared/rams';
import { BriefingChip, PackStatusChip } from '../../../src/components/rams/chips';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Input } from '../../../src/components/ui/input';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';

type StatusFilter = RamsPackStatus | 'all';
const STATUS_FILTERS: ReadonlyArray<StatusFilter> = ['all', ...RAMS_PACK_STATUSES];

function formatDate(value: Date | string | null): string {
  if (value === null) return '—';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export default function RamsRegisterPage() {
  const t = useTranslations('rams');
  const params = useParams<{ locale: string }>();
  const locale = params.locale;
  const canCreate = useHasPermission('rams.create');
  const canReview = useHasPermission('rams.review');

  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  // RS-A14: the "awaiting client acceptance" chip was an inert span while
  // every chip beside it filtered. It is a filter now.
  const [pendingAcceptanceOnly, setPendingAcceptanceOnly] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const overview = trpc.rams.packs.overview.useQuery();
  const packs = trpc.rams.packs.list.useQuery({
    ...(status !== 'all' ? { status } : {}),
    ...(search.trim().length > 0 ? { search: search.trim() } : {}),
    ...(pendingAcceptanceOnly ? { pendingClientAcceptance: true } : {}),
  });
  const csv = trpc.useUtils().rams.packs.exportCsv;

  async function downloadCsv(): Promise<void> {
    // RS-A14: an export that throws left the button looking like it worked.
    try {
      const result = await csv.fetch({});
      setExportError(null);
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rams-register.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    }
  }

  const attention = overview.data;
  const rows = packs.data ?? [];

  return (
    <main>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild type="button" variant="outline" size="sm">
            <Link href={`/${locale}/rams/library`}>
              <FolderOpen className="mr-1.5 h-4 w-4" aria-hidden />
              {t('library.title')}
            </Link>
          </Button>
          {canReview ? (
            <Button asChild type="button" variant="outline" size="sm">
              <Link href={`/${locale}/rams/reviews`}>
                <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden />
                {t('reviews.title')}
              </Link>
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => void downloadCsv()}>
            <Download className="mr-1.5 h-4 w-4" aria-hidden />
            {t('exportCsv')}
          </Button>
          {canCreate ? (
            <Button asChild type="button" size="sm">
              <Link href={`/${locale}/rams/new`}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                {t('newPack')}
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      {attention !== undefined &&
      attention.draftPacks +
        attention.awaitingBriefing +
        attention.pendingClientAcceptance +
        attention.pendingReviews +
        attention.expiringReviews >
        0 ? (
        <section className="mb-5" aria-label={t('needsAttention')}>
          <div className="flex flex-wrap gap-2">
            {attention.draftPacks > 0 ? (
              <button
                type="button"
                onClick={() => setStatus('draft')}
                className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100"
              >
                {t('attention.draftPacks', { count: attention.draftPacks })}
              </button>
            ) : null}
            {attention.awaitingBriefing > 0 ? (
              <button
                type="button"
                onClick={() => setStatus('issued')}
                className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-100"
              >
                {t('attention.awaitingBriefing', { count: attention.awaitingBriefing })}
              </button>
            ) : null}
            {attention.pendingClientAcceptance > 0 ? (
              <button
                type="button"
                aria-pressed={pendingAcceptanceOnly}
                onClick={() => setPendingAcceptanceOnly((v) => !v)}
                className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-900 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-100"
              >
                {t('attention.pendingClientAcceptance', {
                  count: attention.pendingClientAcceptance,
                })}
              </button>
            ) : null}
            {canReview && attention.pendingReviews > 0 ? (
              <Link
                href={`/${locale}/rams/reviews`}
                className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-900 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-100"
              >
                {t('attention.pendingReviews', { count: attention.pendingReviews })}
              </Link>
            ) : null}
            {canReview && attention.expiringReviews > 0 ? (
              <Link
                href={`/${locale}/rams/reviews`}
                className="rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-900 hover:bg-red-200 dark:bg-red-900 dark:text-red-100"
              >
                {t('attention.expiringReviews', { count: attention.expiringReviews })}
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {exportError !== null ? (
        <p className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {t('exportFailed', { message: exportError })}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="max-w-xs"
        />
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded-full border px-3 py-1 text-sm ${
                status === s ? 'bg-foreground text-background' : 'hover:bg-muted'
              }`}
            >
              {s === 'all' ? t('filters.all') : t(`status.${s}`)}
            </button>
          ))}
        </div>
      </div>

      {packs.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground">{t('empty')}</p>
            {canCreate ? (
              <Button asChild type="button" className="mt-4">
                <Link href={`/${locale}/rams/new`}>{t('newPack')}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border bg-card text-card-foreground shadow-sm md:block">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground border-b text-left">
                <tr>
                  <th className="py-2 pr-3 font-medium">{t('columns.reference')}</th>
                  <th className="py-2 pr-3 font-medium">{t('columns.title')}</th>
                  <th className="py-2 pr-3 font-medium">{t('columns.client')}</th>
                  <th className="py-2 pr-3 font-medium">{t('columns.site')}</th>
                  <th className="py-2 pr-3 font-medium">{t('columns.planned')}</th>
                  <th className="py-2 pr-3 font-medium">{t('columns.status')}</th>
                  <th className="py-2 font-medium">{t('columns.briefing')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/50 border-b">
                    <td className="py-2 pr-3 font-mono text-xs">
                      <Link className="hover:underline" href={`/${locale}/rams/${r.id}`}>
                        {r.referenceNumber ?? r.id.slice(-6)}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">
                      <Link className="hover:underline" href={`/${locale}/rams/${r.id}`}>
                        {r.title}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{r.clientName}</td>
                    <td className="py-2 pr-3">{r.siteName ?? '—'}</td>
                    <td className="py-2 pr-3">{formatDate(r.plannedFrom)}</td>
                    <td className="py-2 pr-3">
                      <PackStatusChip status={r.status} />
                    </td>
                    <td className="py-2">
                      <BriefingChip
                        onCurrent={r.briefedOnCurrentVersion}
                        currentVersion={r.currentVersion}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {rows.map((r) => (
              <Link key={r.id} href={`/${locale}/rams/${r.id}`} className="block">
                <Card>
                  <CardContent className="space-y-1 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">
                        {r.referenceNumber ?? r.id.slice(-6)}
                      </span>
                      <PackStatusChip status={r.status} />
                    </div>
                    <div className="font-medium">{r.title}</div>
                    <div className="text-muted-foreground text-sm">
                      {r.clientName} · {r.siteName ?? '—'}
                    </div>
                    <BriefingChip
                      onCurrent={r.briefedOnCurrentVersion}
                      currentVersion={r.currentVersion}
                    />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
