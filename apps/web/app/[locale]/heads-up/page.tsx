'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ModuleHeader } from '../../../src/components/module-header';
import { ResultsFooter } from '../../../src/components/results-footer';
import { FilterBar, type FilterDef } from '../../../src/components/filter-bar';
import { BriefingComposer } from '../../../src/components/heads-up/briefing-composer';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../src/components/ui/dialog';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { cn } from '../../../src/lib/cn';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';
import { formatDate } from '../../../src/lib/format-date';

type StatusFilter = 'all' | 'draft' | 'published' | 'archived';
type FeedFilter = 'all' | 'pending' | 'done';
type ViewMode = 'feed' | 'manage';

const STATUS_OPTIONS: ReadonlyArray<StatusFilter> = ['all', 'draft', 'published', 'archived'];
const FEED_FILTERS: ReadonlyArray<FeedFilter> = ['all', 'pending', 'done'];

export default function HeadsUpListPage() {
  const t = useTranslations('headsUp.list');
  const tInbox = useTranslations('headsUp.inbox');
  const tNew = useTranslations('headsUp.new');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canPublish = useHasPermission('headsUp.publish');
  const canManage = useHasPermission('headsUp.manage');
  const canSeeManage = canPublish || canManage;

  // Default users (no publish/manage rights) only ever see their own feed.
  const [mode, setMode] = useState<ViewMode>('feed');
  const activeMode: ViewMode = canSeeManage ? mode : 'feed';

  // "New briefing" opens the composer in a modal rather than navigating to a
  // dedicated page — the split-view page reads too much like SafetyCulture.
  const [composerOpen, setComposerOpen] = useState(false);
  const utils = trpc.useUtils();
  const closeComposer = () => setComposerOpen(false);
  const onComposerSaved = () => {
    setComposerOpen(false);
    void utils.headsUps.list.invalidate();
    void utils.headsUps.listForRecipient.invalidate();
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top selector — a border-b tab strip like every other module's
       * ModuleTabs (RAMS etc.). Feed/Manage are page modes, not routes,
       * so the strip is rendered here rather than by ModuleTabs. */}
      {canSeeManage ? (
        <div
          className="-mt-1 mb-2 flex gap-1 overflow-x-auto no-scrollbar border-b border-slate-300 dark:border-slate-700"
          role="tablist"
        >
          {(['feed', 'manage'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={activeMode === m}
              onClick={() => setMode(m)}
              className={cn(
                '-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                activeMode === m
                  ? 'border-[#234fe1] font-semibold text-[#234fe1]'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'feed' ? tInbox('tabMyFeed') : tInbox('tabManage')}
            </button>
          ))}
        </div>
      ) : null}

      <ModuleHeader title={t('title')} description={t('subtitle')}>
        {/* Discoverable whenever you can publish — no longer hidden behind
         * being in Manage mode (that was why "new" seemed missing). */}
        {canPublish ? (
          <Button onClick={() => setComposerOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('newButton')}
          </Button>
        ) : null}
      </ModuleHeader>

      {activeMode === 'manage' ? (
        <ManageList
          locale={locale}
          canPublish={canPublish}
          onNew={() => setComposerOpen(true)}
          t={t}
        />
      ) : (
        <RecipientFeed locale={locale} tInbox={tInbox} />
      )}

      {canPublish ? (
        <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{tNew('pageTitle')}</DialogTitle>
            </DialogHeader>
            <BriefingComposer onClose={closeComposer} onSaved={onComposerSaved} />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recipient feed ("My feed")                                          */
/* ------------------------------------------------------------------ */

type FeedItem = {
  id: string;
  title: string;
  engagementLevel: string;
  requireAcknowledgement: boolean;
  requireSignature: boolean;
  publishAt: Date | string | null;
  expiresAt: Date | string | null;
  creatorName: string | null;
  viewedAt: Date | string | null;
  acknowledgedAt: Date | string | null;
  signedAt: Date | string | null;
  pending: boolean;
};

function RecipientFeed({ locale, tInbox }: { locale: string; tInbox: (key: string) => string }) {
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [search, setSearch] = useState('');
  // Status starts behind the "+ Add filter" button (empty active set).
  const [activeFilters, setActiveFilters] = useState<ReadonlySet<string>>(new Set());
  const { data, isLoading, error } = trpc.headsUps.listForRecipient.useQuery({ filter });

  const rows = useMemo(() => {
    const all = (data ?? []) as FeedItem[];
    const needle = search.trim().toLowerCase();
    return needle.length === 0 ? all : all.filter((r) => r.title.toLowerCase().includes(needle));
  }, [data, search]);

  const filterDefs: FilterDef[] = [
    {
      key: 'status',
      label: tInbox('statusFilter'),
      control: {
        kind: 'select',
        value: filter,
        onValueChange: (v) => setFilter(v as FeedFilter),
        options: FEED_FILTERS.map((f) => ({
          value: f,
          label: tInbox(
            f === 'all' ? 'filterAll' : f === 'pending' ? 'filterPending' : 'filterDone',
          ),
        })),
      },
    },
  ];
  const activeKeys = filterDefs.map((f) => f.key).filter((k) => activeFilters.has(k));

  return (
    <div className="space-y-4">
      <h2 className="sr-only">{tInbox('feedTitle')}</h2>
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: tInbox('searchPlaceholder') }}
        filters={filterDefs}
        activeKeys={activeKeys}
        onAddFilter={(k) => setActiveFilters((prev) => new Set(prev).add(k))}
        onRemoveFilter={(k) => {
          setActiveFilters((prev) => {
            const next = new Set(prev);
            next.delete(k);
            return next;
          });
          if (k === 'status') setFilter('all');
        }}
      />

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {tInbox('loadError')}
        </p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>{tInbox('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Link key={row.id} href={`/${locale}/heads-up/${row.id}/view`} className="block">
              <Card className="transition-colors hover:bg-muted/30">
                <CardContent className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-medium">{row.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.creatorName ?? '—'}
                      {row.publishAt !== null ? ` · ${formatDate(row.publishAt, locale)}` : ''}
                    </p>
                  </div>
                  <FeedChip item={row} tInbox={tInbox} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function FeedChip({ item, tInbox }: { item: FeedItem; tInbox: (key: string) => string }) {
  let labelKey: string;
  let done: boolean;
  if (item.engagementLevel === 'sign') {
    done = item.signedAt !== null;
    labelKey = done ? 'signedBadge' : 'needsSign';
  } else if (item.engagementLevel === 'acknowledge') {
    done = item.acknowledgedAt !== null;
    labelKey = done ? 'acknowledgedBadge' : 'needsAck';
  } else {
    done = item.viewedAt !== null;
    labelKey = done ? 'viewedBadge' : 'needsView';
  }
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        done
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100'
          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100'
      }`}
    >
      {tInbox(labelKey)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Management list ("Manage")                                          */
/* ------------------------------------------------------------------ */

function ManageList({
  locale,
  canPublish,
  onNew,
  t,
}: {
  locale: string;
  canPublish: boolean;
  onNew: () => void;
  t: (key: string) => string;
}) {
  const tCommon = useTranslations('common');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<ReadonlySet<string>>(new Set());

  const { data, isLoading, error } = trpc.headsUps.list.useQuery({
    status: status === 'all' ? undefined : status,
  });

  const rows = useMemo(() => {
    const all = data ?? [];
    const needle = search.trim().toLowerCase();
    return needle.length === 0 ? all : all.filter((r) => r.title.toLowerCase().includes(needle));
  }, [data, search]);

  const filterDefs: FilterDef[] = [
    {
      key: 'status',
      label: tCommon('status'),
      control: {
        kind: 'select',
        value: status,
        onValueChange: (v) => setStatus(v as StatusFilter),
        options: STATUS_OPTIONS.map((s) => ({ value: s, label: t(`status.${s}`) })),
      },
    },
  ];
  const activeKeys = filterDefs.map((f) => f.key).filter((k) => activeFilters.has(k));

  return (
    <div className="space-y-4 sm:space-y-6">
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: t('searchPlaceholder') }}
        filters={filterDefs}
        activeKeys={activeKeys}
        onAddFilter={(k) => setActiveFilters((prev) => new Set(prev).add(k))}
        onRemoveFilter={(k) => {
          setActiveFilters((prev) => {
            const next = new Set(prev);
            next.delete(k);
            return next;
          });
          if (k === 'status') setStatus('all');
        }}
      />

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {t('loadError')}
        </p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>{t('empty')}</p>
            {canPublish ? (
              <button
                type="button"
                onClick={onNew}
                className="mt-2 inline-block text-foreground underline-offset-4 hover:underline"
              >
                {t('emptyCta')}
              </button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Table (desktop) — hidden under md; the card list takes over there. */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">{t('columns.title')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.status')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.audience')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.engagement')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.createdBy')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.createdAt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium">
                          <Link href={`/${locale}/heads-up/${row.id}`} className="hover:underline">
                            {row.title}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={row.status} t={t} />
                        </td>
                        <td className="px-3 py-2">
                          <AudienceCell audience={row.audience} t={t} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {t(`engagement.${row.engagementLevel}`)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.creatorName ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatDate(row.createdAt, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Card list (mobile) — stacked layout under md; the table is hidden there. */}
          <div className="space-y-3 md:hidden">
            {rows.map((row) => (
              <Link key={row.id} href={`/${locale}/heads-up/${row.id}`} className="block">
                <Card className="transition-colors hover:bg-muted/30">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 font-medium">{row.title}</p>
                      <StatusBadge status={row.status} t={t} />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-foreground">
                        {t('columns.audience')}
                      </div>
                      <AudienceCell audience={row.audience} t={t} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('columns.createdAt')}: {formatDate(row.createdAt, locale)}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <ResultsFooter count={rows.length} />
        </>
      )}
    </div>
  );
}

const MAX_AUDIENCE_CHIPS = 3;

function AudienceCell({
  audience,
  t,
}: {
  audience: { groupNames: string[]; siteNames: string[]; hasIndividualUsers: boolean };
  t: (k: string) => string;
}) {
  const allNames = [...audience.groupNames, ...audience.siteNames];
  if (audience.hasIndividualUsers && allNames.length === 0) {
    return <span className="text-xs text-muted-foreground">{t('audienceIndividual')}</span>;
  }
  if (allNames.length === 0) {
    return <span className="text-xs text-muted-foreground">{t('audienceAll')}</span>;
  }
  const visible = allNames.slice(0, MAX_AUDIENCE_CHIPS);
  const overflow = allNames.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((name) => (
        <span
          key={name}
          className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
        >
          {name}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const classMap: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
    published: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
    archived: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${classMap[status] ?? classMap['draft']}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}
