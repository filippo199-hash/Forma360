'use client';

/**
 * The matrix grid (FreeHS B7) — people down, requirements across, one
 * glyph per cell.
 *
 * This is the classic artefact everyone pictures, and Nair's warning
 * about it is built in: *"800 × 30 is not a screen, it's a query. The
 * grid is only readable once filtered."* So it filters by requirement
 * before it renders, scrolls horizontally inside its own container, and
 * exports to CSV — because the grid is a board paper and has to leave
 * the building looking like one.
 */
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { StatusGlyph, StatusLegend } from '../../../../src/components/training/status-chip';
import { TrainingTabs } from '../../../../src/components/training/training-tabs';
import { trpc } from '../../../../src/lib/trpc/client';
import type { TrainingStatus } from '@forma360/shared/training';

export default function TrainingMatrixPage() {
  const t = useTranslations('training');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const [requirementFilter, setRequirementFilter] = useState('');

  const { data, isLoading } = trpc.training.matrix.useQuery(
    requirementFilter === '' ? {} : { requirementId: requirementFilter },
  );

  /** Cells keyed for O(1) lookup while rendering the grid. */
  const cellIndex = useMemo(() => {
    const map = new Map<string, TrainingStatus>();
    for (const c of data?.cells ?? []) {
      map.set(`${c.personKey}::${c.requirementId}`, c.status);
    }
    return map;
  }, [data?.cells]);

  // Only people who have at least one cell — an empty row teaches nothing
  // and 800 of them make the grid unreadable.
  const rows = useMemo(() => {
    const withCells = new Set((data?.cells ?? []).map((c) => c.personKey));
    return (data?.people ?? []).filter((p) =>
      withCells.has(p.userId ?? `name:${p.name.toLowerCase()}`),
    );
  }, [data?.people, data?.cells]);

  const requirements = data?.requirements ?? [];

  function exportCsv() {
    const header = ['Person', ...requirements.map((r) => r.name)];
    const lines = [header.join(',')];
    for (const p of rows) {
      const key = p.userId ?? `name:${p.name.toLowerCase()}`;
      const cells = requirements.map((r) => cellIndex.get(`${key}::${r.id}`) ?? 'not_required');
      lines.push([p.name, ...cells].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `training-matrix-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <TrainingTabs activeTab="matrix" locale={locale} />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('tabs.matrix')}</h1>
          {data !== undefined ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('asAt', { date: new Date(data.asOf).toLocaleDateString(locale) })}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={requirementFilter}
            onChange={(e) => setRequirementFilter(e.target.value)}
            aria-label={t('tabs.requirements')}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">{t('tabs.requirements')}</option>
            {requirements.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            {t('matrix.exportCsv')}
          </Button>
        </div>
      </header>

      <StatusLegend />

      {isLoading ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
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
            {/* The grid scrolls inside its own container; the page never
                scrolls sideways. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left font-medium">
                      {t('matrix.person')}
                    </th>
                    {requirements.map((r) => (
                      <th
                        key={r.id}
                        className="px-2 py-2 text-center text-xs font-medium"
                        title={r.name}
                      >
                        <span className="block max-w-24 truncate">{r.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const key = p.userId ?? `name:${p.name.toLowerCase()}`;
                    return (
                      <tr key={key} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="sticky left-0 z-10 bg-background px-3 py-2 font-medium">
                          <span className="block max-w-48 truncate">{p.name}</span>
                        </td>
                        {requirements.map((r) => (
                          <td key={r.id} className="px-2 py-2 text-center">
                            <StatusGlyph
                              status={cellIndex.get(`${key}::${r.id}`) ?? 'not_required'}
                            />
                          </td>
                        ))}
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
