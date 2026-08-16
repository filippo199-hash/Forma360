'use client';

import { CalendarDays, DoorOpen, FileText, HardHat, LogOut, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FilterBar } from '../../../src/components/filter-bar';
import { ResultsFooter } from '../../../src/components/results-footer';
import { downloadCsv } from '../../../src/lib/download-csv';
import { ModuleHeader } from '../../../src/components/module-header';
import { CreateContractorDialog } from '../../../src/components/contractors/create-contractor-dialog';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Textarea } from '../../../src/components/ui/textarea';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { TooltipIconButton } from '../../../src/components/ui/tooltip-icon-button';
import { cn } from '../../../src/lib/cn';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { contractorErrorMessage } from '../../../src/lib/contractor-errors';
import { trpc } from '../../../src/lib/trpc/client';

/** Viewer's timezone — check-in times are stored as absolute instants. */
const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

type Compliance = 'compliant' | 'non_compliant' | 'no_requirements' | 'suspended';

const BADGE: Record<Compliance, string> = {
  compliant: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  non_compliant: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
  suspended: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-100',
  no_requirements: 'bg-muted text-muted-foreground',
};

export default function ContractorsPage() {
  const t = useTranslations('contractors');
  const format = useFormatter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('contractors.manage');
  // The permit chip below deep-links into the permits module, which is
  // gated on its own key — render it as plain text for anyone who would
  // land on a "you don't have access" page.
  const canViewPermits = useHasPermission('permits.view');
  const utils = trpc.useUtils();

  // CT-V02: the register is paged and searched server-side. It used to
  // load every contractor plus their whole requirement + document graph
  // and filter in the browser.
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const { data, isLoading, error } = trpc.contractors.list.useQuery({
    limit: 50,
    ...(search.trim() === '' ? {} : { search: search.trim() }),
    ...(cursor === undefined ? {} : { cursor }),
  });
  // Live "who is on site" board for the gate guard — refetch every 30s.
  const onSite = trpc.contractors.visits.onSiteNow.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const checkOut = trpc.contractors.visits.checkOut.useMutation({
    onSuccess: () => {
      toast.success(t('visits.checkedOutToast'));
      void utils.contractors.visits.onSiteNow.invalidate();
    },
    onError: (err) => toast.error(contractorErrorMessage(err.message, t)),
  });
  // PF-19: the permits↔contractors join — who is inside with live permits.
  const openPermits = trpc.contractors.visits.onSiteWithOpenPermits.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  // PF-19: versioned induction text editor (manage only).
  const induction = trpc.contractors.induction.get.useQuery(undefined, { enabled: canManage });
  const [inductionDraft, setInductionDraft] = useState<string | null>(null);
  const saveInduction = trpc.contractors.induction.set.useMutation({
    onSuccess: (res) => {
      toast.success(t('induction.savedToast', { version: res.version }));
      setInductionDraft(null);
      void utils.contractors.induction.get.invalidate();
    },
    onError: (err) => toast.error(contractorErrorMessage(err.message, t)),
  });

  // Group the on-site people by contractor so the guard sees, per contractor,
  // the headcount and who exactly is still inside.
  type OnSiteRow = NonNullable<typeof onSite.data>[number];
  const onSiteTotal = onSite.data?.length ?? 0;
  const onSiteGroups = useMemo(() => {
    const map = new Map<
      string,
      { contractorId: string; contractorName: string; people: OnSiteRow[] }
    >();
    for (const v of onSite.data ?? []) {
      const g = map.get(v.contractorId) ?? {
        contractorId: v.contractorId,
        contractorName: v.contractorName,
        people: [],
      };
      g.people.push(v);
      map.set(v.contractorId, g);
    }
    return [...map.values()];
  }, [onSite.data]);
  const all = data?.contractors ?? [];
  // CT filter: compliance status, applied over the loaded page.
  const [compliance, setCompliance] = useState<'all' | Compliance>('all');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const visible = compliance === 'all' ? all : all.filter((c) => c.complianceStatus === compliance);

  // NR3-03: dialog form state lives inside CreateContractorDialog so
  // Cancel/Escape clears it — it used to persist here and double up.
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4 sm:space-y-6">
      <ModuleHeader title={t('title')} description={t('subtitle')}>
        <Button variant="outline" asChild>
          <Link href={`/${locale}/contractors/calendar`}>
            <CalendarDays className="mr-1.5 h-4 w-4" />
            {t('visits.calendarLink')}
          </Link>
        </Button>
        {canManage ? (
          <Button variant="outline" asChild>
            <Link href={`/${locale}/contractors/gate`}>
              <DoorOpen className="mr-1.5 h-4 w-4" />
              {t('gate.navLink')}
            </Link>
          </Button>
        ) : null}
        {canManage ? (
          <TooltipIconButton
            icon={FileText}
            label={t('manageTemplates')}
            href={`/${locale}/contractors/templates`}
          />
        ) : null}
        {canManage ? (
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('newButton')}
          </Button>
        ) : null}
      </ModuleHeader>

      {/* Gate board — who is currently on site, grouped by contractor. */}
      {onSite.error !== null && onSiteTotal === 0 ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">
            {t('onSite.loadError')}
          </CardContent>
        </Card>
      ) : onSiteTotal > 0 ? (
        <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <DoorOpen className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-sm font-semibold">
                {t('onSite.heading', { count: onSiteTotal })}
              </h2>
            </div>
            <div className="space-y-4">
              {onSiteGroups.map((g) => (
                <div key={g.contractorId}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <Link
                      href={`/${locale}/contractors/${g.contractorId}`}
                      className="text-sm font-semibold hover:underline"
                    >
                      {g.contractorName}
                    </Link>
                    <span className="shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      {t('onSite.perContractor', { count: g.people.length })}
                    </span>
                  </div>
                  <ul className="divide-y divide-emerald-200/60 dark:divide-emerald-900/40">
                    {g.people.map((v) => {
                      const personName = v.visitorName ?? v.title;
                      const subline = [
                        v.visitorName !== null ? v.title : '',
                        v.siteName !== null ? v.siteName : '',
                        v.checkedInAt !== null
                          ? t('onSite.since', {
                              time: format.dateTime(new Date(v.checkedInAt), {
                                timeStyle: 'short',
                                timeZone: BROWSER_TZ,
                              }),
                            })
                          : '',
                      ]
                        .filter((s) => s !== '')
                        .join(' · ');
                      return (
                        <li key={v.id} className="flex items-center gap-3 py-2 text-sm">
                          <span className="relative flex h-2.5 w-2.5 shrink-0">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium" title={personName}>
                              {personName}
                              {v.isWalkIn ? (
                                <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                                  {t('visits.walkInBadge')}
                                </span>
                              ) : null}
                            </p>
                            <p className="truncate text-xs text-muted-foreground" title={subline}>
                              {subline}
                            </p>
                          </div>
                          {canManage ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 shrink-0"
                              disabled={checkOut.isPending}
                              onClick={() => checkOut.mutate({ id: v.id })}
                            >
                              <LogOut className="mr-1 h-3.5 w-3.5" />
                              {t('visits.checkOut')}
                            </Button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* PF-19: contractors on site holding open permits — the join the
       * review found missing. */}
      {(openPermits.data?.length ?? 0) > 0 ? (
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <h2 className="mb-2 text-sm font-semibold">{t('onSitePermits.heading')}</h2>
            <ul className="divide-y divide-amber-200/60 text-sm dark:divide-amber-900/40">
              {(openPermits.data ?? []).map((r) => (
                <li
                  key={`${r.visitId}-${r.permitId}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span className="min-w-0 truncate">
                    <Link
                      href={`/${locale}/contractors/${r.contractorId}`}
                      className="font-medium hover:underline"
                    >
                      {r.contractorName}
                    </Link>
                    <span className="text-muted-foreground"> — {r.permitTitle}</span>
                  </span>
                  {canViewPermits ? (
                    <Link
                      href={`/${locale}/permits/${r.permitId}`}
                      className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 hover:underline dark:bg-amber-900/40 dark:text-amber-100"
                    >
                      {r.permitReference ?? r.permitId}
                    </Link>
                  ) : (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                      {r.permitReference ?? r.permitId}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* PF-19: versioned site induction — editing bumps the version and
       * forces every portal user to re-acknowledge. */}
      {canManage ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t('induction.heading')}</h2>
              <span className="text-xs text-muted-foreground">
                {t('induction.version', { version: induction.data?.version ?? 1 })}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{t('induction.hint')}</p>
            <Textarea
              value={inductionDraft ?? induction.data?.body ?? ''}
              onChange={(e) => setInductionDraft(e.target.value)}
              rows={4}
              maxLength={20_000}
              placeholder={t('induction.placeholder')}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={
                  saveInduction.isPending ||
                  inductionDraft === null ||
                  inductionDraft.trim() === '' ||
                  inductionDraft === (induction.data?.body ?? '')
                }
                onClick={() => {
                  if (inductionDraft !== null) saveInduction.mutate({ body: inductionDraft });
                }}
              >
                {t('induction.saveButton')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <FilterBar
        search={{
          value: search,
          // Any new search restarts at page one — a cursor from the old
          // result set would page into nothing.
          onChange: (v: string) => {
            setSearch(v);
            setCursors([]);
          },
          placeholder: t('searchPlaceholder'),
        }}
        filters={[
          {
            key: 'compliance',
            label: t('filterCompliance'),
            control: {
              kind: 'select',
              value: compliance,
              onValueChange: (v) => setCompliance(v as 'all' | Compliance),
              options: [
                { value: 'all', label: t('filterComplianceAll') },
                { value: 'compliant', label: t('status_compliant') },
                { value: 'non_compliant', label: t('status_non_compliant') },
                { value: 'suspended', label: t('status_suspended') },
                { value: 'no_requirements', label: t('status_no_requirements') },
              ],
            },
          },
        ]}
        activeKeys={activeFilters.has('compliance') ? ['compliance'] : []}
        onAddFilter={(k) => setActiveFilters((prev) => new Set(prev).add(k))}
        onRemoveFilter={(k) => {
          setActiveFilters((prev) => {
            const next = new Set(prev);
            next.delete(k);
            return next;
          });
          if (k === 'compliance') setCompliance('all');
        }}
      />

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : error !== null ? (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-destructive">
            <HardHat className="h-6 w-6" />
            <p>{t('loadError')}</p>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <HardHat className="h-6 w-6" />
            <p>{t('empty')}</p>
            {canManage ? (
              <Button className="mt-2" onClick={() => setOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                {t('newButton')}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Table (desktop) — the mobile card list below takes over under md. */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t('colName')}</th>
                      <th className="px-4 py-3 font-medium">{t('colCategory')}</th>
                      <th className="px-4 py-3 font-medium">{t('colContact')}</th>
                      <th className="px-4 py-3 font-medium">{t('colCompliance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c) => {
                      const status = c.complianceStatus as Compliance;
                      return (
                        <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <Link
                              href={`/${locale}/contractors/${c.id}`}
                              className="font-medium text-foreground hover:underline"
                            >
                              {c.name}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{c.category ?? '—'}</td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {c.primaryContactName ?? c.primaryContactEmail ?? '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                                BADGE[status],
                              )}
                            >
                              {t(`status_${status}` as 'status_compliant')}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Card list (mobile) — stacked layout under md; the table is hidden there. */}
          <div className="space-y-3 md:hidden">
            {visible.map((c) => {
              const status = c.complianceStatus as Compliance;
              return (
                <Link key={c.id} href={`/${locale}/contractors/${c.id}`} className="block">
                  <Card className="transition-colors hover:bg-muted/30">
                    <CardContent className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 truncate font-medium">{c.name}</p>
                        <span
                          className={cn(
                            'inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                            BADGE[status],
                          )}
                        >
                          {t(`status_${status}` as 'status_compliant')}
                        </span>
                      </div>
                      <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>
                          <dt className="font-medium text-foreground">{t('colCategory')}</dt>
                          <dd className="truncate">{c.category ?? '—'}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-foreground">{t('colContact')}</dt>
                          <dd className="truncate">
                            {c.primaryContactName ?? c.primaryContactEmail ?? '—'}
                          </dd>
                        </div>
                      </dl>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>

          <ResultsFooter
            count={visible.length}
            onDownloadCsv={() =>
              downloadCsv(
                'contractors',
                [t('colName'), t('colCategory'), t('colContact'), t('colCompliance')],
                visible.map((c) => [
                  c.name,
                  c.category ?? '',
                  c.primaryContactName ?? '',
                  t(`status_${c.complianceStatus as Compliance}` as 'status_compliant'),
                ]),
              )
            }
          />

          {/* CT-V02: the register no longer ships every row, so it has to
              say when there are more and offer a way to reach them. */}
          {data !== undefined && (data.hasMore || cursors.length > 0) ? (
            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={cursors.length === 0}
                onClick={() => setCursors((prev) => prev.slice(0, -1))}
              >
                {t('pagerPrevious')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!data.hasMore || data.nextCursor === null}
                onClick={() =>
                  setCursors((prev) =>
                    data.nextCursor === null ? prev : [...prev, data.nextCursor],
                  )
                }
              >
                {t('pagerNext')}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <CreateContractorDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
