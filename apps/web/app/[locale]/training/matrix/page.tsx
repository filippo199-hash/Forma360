'use client';

/**
 * The matrix grid (FreeHS B7) — people down, requirements across, one
 * glyph per cell.
 *
 * Nair asked for four things and the first cut delivered one. Now:
 *   - **cells are clickable** — a cell opens that person's wallet, which
 *     is where the record, the expiry and the certificate live (TR-A14);
 *   - **columns sort by gap count**, worst first, so the column that
 *     needs work leads (TR-A14);
 *   - the filter takes **site as well as requirement**, which is what
 *     makes 800 × 30 readable at all, and reads from the **URL** so the
 *     compliance drill-down can hand it a filter (TR-A12);
 *   - export writes **labels, not raw enums**, and offers **PDF** as well
 *     as CSV, because the grid is a board paper and a tender document
 *     (TR-A14).
 */
import { ArrowDownWideNarrow, FileWarning } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { TRAINING_STATUS_GLYPH, type TrainingStatus } from '@forma360/shared/training';
import { ModuleHeader } from '../../../../src/components/module-header';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { StatusGlyph, StatusLegend } from '../../../../src/components/training/status-chip';
import { TrainingTabs } from '../../../../src/components/training/training-tabs';
import { trpc } from '../../../../src/lib/trpc/client';

function MatrixInner() {
  const t = useTranslations('training');
  const tStatus = useTranslations('training.status');
  const tErr = useTranslations('training.errors');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();
  const search = useSearchParams();

  // Filters live in the URL so the compliance page can link INTO a
  // filtered grid — the drill-down that was a single broken hop.
  const requirementFilter = search.get('requirementId') ?? '';
  const siteFilter = search.get('siteId') ?? '';
  const asOf = search.get('asOf') ?? '';
  const [sortByGaps, setSortByGaps] = useState(false);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(search.toString());
    if (value === '') next.delete(key);
    else next.set(key, value);
    router.replace(`/${locale}/training/matrix${next.size > 0 ? `?${next.toString()}` : ''}`);
  }

  const query = trpc.training.matrix.useQuery({
    ...(requirementFilter !== '' ? { requirementId: requirementFilter } : {}),
    ...(siteFilter !== '' ? { siteId: siteFilter } : {}),
    ...(asOf !== '' ? { asOf } : {}),
  });
  const data = query.data;

  const cellIndex = useMemo(() => {
    const map = new Map<string, TrainingStatus>();
    for (const c of data?.cells ?? []) map.set(`${c.personKey}::${c.requirementId}`, c.status);
    return map;
  }, [data?.cells]);

  const rows = useMemo(() => {
    const withCells = new Set((data?.cells ?? []).map((c) => c.personKey));
    return (data?.people ?? []).filter((p) =>
      withCells.has(p.userId ?? `name:${p.name.toLowerCase()}`),
    );
  }, [data?.people, data?.cells]);

  /** Gap count per requirement, so the worst column can lead. */
  const gapsByRequirement = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of data?.cells ?? []) {
      if (!c.required) continue;
      if (c.status === 'expired' || c.status === 'not_held' || c.status === 'expiring_soon') {
        counts.set(c.requirementId, (counts.get(c.requirementId) ?? 0) + 1);
      }
    }
    return counts;
  }, [data?.cells]);

  const requirements = useMemo(() => {
    const list = [...(data?.requirements ?? [])];
    if (!sortByGaps) return list;
    return list.sort(
      (a, b) => (gapsByRequirement.get(b.id) ?? 0) - (gapsByRequirement.get(a.id) ?? 0),
    );
  }, [data?.requirements, sortByGaps, gapsByRequirement]);

  /** Human labels, never raw enum values — this leaves the building. */
  function exportRows(): string[][] {
    const header = [t('matrix.person'), ...requirements.map((r) => r.name)];
    const body = rows.map((p) => {
      const key = p.userId ?? `name:${p.name.toLowerCase()}`;
      return [
        p.name,
        ...requirements.map((r) => {
          const st = cellIndex.get(`${key}::${r.id}`) ?? 'not_required';
          return `${TRAINING_STATUS_GLYPH[st]} ${tStatus(st)}`;
        }),
      ];
    });
    return [header, ...body];
  }

  function exportCsv() {
    const csv = exportRows()
      .map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `training-matrix-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * The board paper / tender document. Printed from a plain window rather
   * than a server renderer: the grid is already laid out, and the browser
   * makes a better job of paginating a wide table than we would.
   */
  function exportPdf() {
    const table = exportRows();
    const head = table[0] ?? [];
    const win = window.open('', '_blank');
    if (win === null) return;
    const esc = (v: string) => v.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
    win.document.write(`<!doctype html><html><head><title>${esc(t('title'))}</title>
      <style>
        body{font-family:system-ui,sans-serif;padding:24px;color:#0f172a}
        h1{font-size:18px;margin:0 0 4px}
        p{font-size:12px;color:#475569;margin:0 0 16px}
        table{border-collapse:collapse;width:100%;font-size:11px}
        th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left}
        th{background:#f1f5f9}
        @page{size:landscape}
      </style></head><body>
      <h1>${esc(t('title'))}</h1>
      <p>${esc(t('asAt', { date: new Date(data?.asOf ?? Date.now()).toLocaleDateString(locale) }))}</p>
      <table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${table
        .slice(1)
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  function walletHref(person: { userId: string | null; name: string }): string {
    return person.userId !== null
      ? `/${locale}/training/person?userId=${encodeURIComponent(person.userId)}&name=${encodeURIComponent(person.name)}`
      : `/${locale}/training/person?name=${encodeURIComponent(person.name)}`;
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <TrainingTabs activeTab="matrix" locale={locale} />

      <ModuleHeader
        title={t('tabs.matrix')}
        description={
          data !== undefined
            ? t('asAt', { date: new Date(data.asOf).toLocaleDateString(locale) })
            : ''
        }
      >
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          {t('matrix.exportCsv')}
        </Button>
        <Button variant="outline" onClick={exportPdf} disabled={rows.length === 0}>
          {t('matrix.exportPdf')}
        </Button>
      </ModuleHeader>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="matrix-req" className="text-xs font-medium text-muted-foreground">
            {t('tabs.requirements')}
          </label>
          <select
            id="matrix-req"
            value={requirementFilter}
            onChange={(e) => setParam('requirementId', e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">{t('filters.allRequirements')}</option>
            {(data?.requirements ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="matrix-site" className="text-xs font-medium text-muted-foreground">
            {t('filters.site')}
          </label>
          <SiteSelector
            value={siteFilter !== '' ? [siteFilter] : []}
            onChange={(next) => setParam('siteId', next[0] ?? '')}
            multiple={false}
            placeholder={t('filters.allSites')}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="matrix-asof" className="text-xs font-medium text-muted-foreground">
            {t('filters.asOf')}
          </label>
          <input
            id="matrix-asof"
            type="date"
            value={asOf}
            onChange={(e) => setParam('asOf', e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          />
        </div>
        <Button
          variant={sortByGaps ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSortByGaps((v) => !v)}
        >
          <ArrowDownWideNarrow className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t('matrix.sortByGaps')}
        </Button>
      </div>

      <StatusLegend />

      {query.isPending ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </CardContent>
        </Card>
      ) : query.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <FileWarning className="h-6 w-6 text-destructive" aria-hidden="true" />
            <p className="font-medium">{tErr('loadFailed')}</p>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              {tErr('retry')}
            </Button>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            {t('matrix.empty')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left font-medium">
                      {t('matrix.person')}
                    </th>
                    {requirements.map((r) => {
                      const gaps = gapsByRequirement.get(r.id) ?? 0;
                      return (
                        <th
                          key={r.id}
                          className="px-2 py-2 text-center text-xs font-medium"
                          title={r.name}
                        >
                          <span className="block max-w-24 truncate">{r.name}</span>
                          {gaps > 0 ? (
                            <span className="text-[10px] font-normal text-muted-foreground">
                              {gaps}
                            </span>
                          ) : null}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const key = p.userId ?? `name:${p.name.toLowerCase()}`;
                    return (
                      <tr key={key} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="sticky left-0 z-10 bg-background px-3 py-2 font-medium">
                          <a
                            href={walletHref(p)}
                            className="block max-w-48 truncate hover:underline"
                          >
                            {p.name}
                          </a>
                        </td>
                        {requirements.map((r) => {
                          const status = cellIndex.get(`${key}::${r.id}`) ?? 'not_required';
                          return (
                            <td key={r.id} className="px-2 py-2 text-center">
                              {/* Clickable: a cell opens the record behind it. */}
                              <a
                                href={walletHref(p)}
                                className="inline-flex rounded p-1 hover:bg-muted"
                                aria-label={`${p.name} — ${r.name}`}
                              >
                                <StatusGlyph status={status} />
                              </a>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function TrainingMatrixPage() {
  return (
    <Suspense fallback={null}>
      <MatrixInner />
    </Suspense>
  );
}
