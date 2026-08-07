'use client';

/**
 * The gap list — the module's landing view (FreeHS B7).
 *
 * Nair's design point, and the reason it leads rather than the grid:
 * *"Everyone pictures the grid. The grid matters — but I look at it once
 * a month. What I need on a Tuesday morning is the gap list: who is
 * missing what, sorted by how much it matters."*
 *
 * Review fixes carried here: the list now shows only requirements a
 * person is actually **required** to hold (TR-A7 — a lapsed voluntary
 * card is not a gap); the **as at** and **site** controls are wired
 * (TR-A10), so "was he competent on the day" is reachable from the UI
 * rather than only the API; a failed query renders as a **failure**
 * rather than as "no gaps" (TR-A14), because the safe-looking state is
 * the lie; and rows link to the person's wallet.
 */
import { FileWarning } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FilterBar, type FilterDef } from '../../../src/components/filter-bar';
import { ModuleHeader } from '../../../src/components/module-header';
import { SiteSelector } from '../../../src/components/selectors/site-selector';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { ImportDialog } from '../../../src/components/training/import-dialog';
import { RecordDialog } from '../../../src/components/training/record-dialog';
import { StatusChip } from '../../../src/components/training/status-chip';
import { TrainingTabs } from '../../../src/components/training/training-tabs';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';

interface GapRow {
  personKey: string;
  personName: string;
  userId: string | null;
  requirementId: string;
  requirementName: string;
  expiresAt: Date | null;
}

export default function TrainingGapsPage() {
  const t = useTranslations('training');
  const tErr = useTranslations('training.errors');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canRecord = useHasPermission('training.record');
  const [prefill, setPrefill] = useState<GapRow | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [asOf, setAsOf] = useState('');
  const [siteId, setSiteId] = useState('');
  // Which filters are revealed as chips (the platform "+ Add filter" model).
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  const query = trpc.training.gaps.useQuery({
    ...(asOf !== '' ? { asOf } : {}),
    ...(siteId !== '' ? { siteId } : {}),
  });
  const data = query.data;

  const formatDate = (d: Date | null): string =>
    d === null ? '—' : new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  const sections: Array<{ key: 'expired' | 'expiringSoon' | 'notHeld'; rows: GapRow[] }> = [
    { key: 'expired', rows: data?.expired ?? [] },
    { key: 'expiringSoon', rows: data?.expiringSoon ?? [] },
    { key: 'notHeld', rows: data?.notHeld ?? [] },
  ];

  function walletHref(row: GapRow): string {
    return row.userId !== null
      ? `/${locale}/training/person?userId=${encodeURIComponent(row.userId)}&name=${encodeURIComponent(row.personName)}`
      : `/${locale}/training/person?name=${encodeURIComponent(row.personName)}`;
  }

  // Same "+ Add filter" chip model as every other module (ADR 0014). The
  // site keeps the hierarchical SiteSelector (a custom control) rather than
  // being flattened into a plain select; "as at" is a single-date chip.
  const filterDefs: FilterDef[] = [
    {
      key: 'site',
      label: t('filters.site'),
      control: {
        kind: 'custom',
        render: () => (
          <SiteSelector
            value={siteId !== '' ? [siteId] : []}
            onChange={(next) => setSiteId(next[0] ?? '')}
            multiple={false}
            placeholder={t('filters.allSites')}
            className="w-56"
          />
        ),
      },
    },
    {
      key: 'asOf',
      label: t('filters.asOf'),
      control: { kind: 'date', value: asOf, onChange: setAsOf },
    },
  ];
  const activeFilterKeys = filterDefs
    .map((f) => f.key)
    .filter((k) => activeFilters.has(k) || (k === 'site' ? siteId !== '' : asOf !== ''));
  function addFilter(key: string): void {
    setActiveFilters((prev) => new Set(prev).add(key));
  }
  function removeFilter(key: string): void {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (key === 'site') setSiteId('');
    if (key === 'asOf') setAsOf('');
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <TrainingTabs activeTab="gaps" locale={locale} />

      {/* The shared module header (ADR 0014 standard). */}
      <ModuleHeader title={t('title')} description={t('subtitle')}>
        <Button asChild variant="outline">
          <Link href={`/${locale}/training/me`}>{t('person.myTitle')}</Link>
        </Button>
        {canRecord ? (
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              {t('import.title')}
            </Button>
            <Button
              onClick={() => {
                setPrefill(null);
                setRecordOpen(true);
              }}
            >
              {t('record.title')}
            </Button>
          </>
        ) : null}
      </ModuleHeader>

      {/* The as-at and site controls the server always accepted (TR-A10),
          now behind the shared "+ Add filter" chip row for platform parity. */}
      <FilterBar
        filters={filterDefs}
        activeKeys={activeFilterKeys}
        onAddFilter={addFilter}
        onRemoveFilter={removeFilter}
        {...(data !== undefined
          ? {
              resultsCount: data.total,
              resultsSuffix: ` · ${t('asAt', { date: new Date(data.asOf).toLocaleDateString(locale) })}`,
            }
          : {})}
      />

      {query.isPending ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </CardContent>
        </Card>
      ) : query.isError ? (
        /* TR-A14: "no gaps" and "the query failed" must not look identical. */
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <FileWarning className="h-6 w-6 text-destructive" aria-hidden="true" />
            <p className="font-medium">{tErr('loadFailed')}</p>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              {tErr('retry')}
            </Button>
          </CardContent>
        </Card>
      ) : data?.siteHasNoMembers === true ? (
        /* TR-B13: "no gaps" and "nobody is a member of this site" looked
           identical, and the reassuring one was the wrong one. */
        <Card>
          <CardContent className="space-y-2 p-10 text-center text-muted-foreground">
            <p>{t('gaps.noSiteMembers')}</p>
            <Link
              href={`/${locale}/sites`}
              className="inline-block text-sm text-primary hover:underline"
            >
              {t('filters.site')}
            </Link>
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
                          <Link
                            href={walletHref(row)}
                            className="block truncate font-medium hover:underline"
                          >
                            {row.personName}
                          </Link>
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
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setPrefill(row);
                              setRecordOpen(true);
                            }}
                          >
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
        open={recordOpen}
        onOpenChange={(v) => {
          setRecordOpen(v);
          if (!v) setPrefill(null);
        }}
        {...(prefill !== null
          ? {
              prefill: {
                requirementId: prefill.requirementId,
                personName: prefill.personName,
                userId: prefill.userId,
              },
            }
          : {})}
      />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
