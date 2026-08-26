'use client';

/**
 * Tenant-wide audit feed (platform HSE review PF-31). Merges every
 * module's append-only event table into one reverse-chronological stream,
 * gated by `org.audit.view` — the key existed since Phase 1 with nothing
 * consuming it.
 *
 * Filtering (search + module / user / event-type) is server-side so keyset
 * pagination stays correct: each source query returns up to `limit`
 * MATCHING rows, and "Load older" walks strictly older than the last one.
 */
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { FilterBar, type FilterDef } from '../../../../src/components/filter-bar';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Button } from '../../../../src/components/ui/button';
import { trpc } from '../../../../src/lib/trpc/client';
import { formatDateTime } from '../../../../src/lib/format-date';

const MODULES = [
  'all',
  'actions',
  'observations',
  'permits',
  'coshh',
  'riskAssessments',
  'fireSafety',
  'contractors',
] as const;
type ModuleFilter = (typeof MODULES)[number];

interface AuditRow {
  module: string;
  entityId: string;
  kind: string;
  detail: string;
  actorName: string | null;
  createdAt: Date;
}

export default function AuditLogPage() {
  const t = useTranslations('settings.audit');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  const [module, setModule] = useState<ModuleFilter>('all');
  const [actorUserId, setActorUserId] = useState<string>('all');
  const [eventType, setEventType] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<ReadonlySet<string>>(new Set());

  const [before, setBefore] = useState<string | undefined>(undefined);
  const [older, setOlder] = useState<AuditRow[]>([]);

  // Debounce the free-text search so we don't refetch on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Any filter change resets pagination — the accumulated "older" pages and
  // the keyset cursor belong to the previous filter set.
  useEffect(() => {
    setBefore(undefined);
    setOlder([]);
  }, [module, actorUserId, eventType, search]);

  const users = trpc.users.list.useQuery({});

  const feed = trpc.admin.auditLog.useQuery({
    limit: 50,
    module,
    ...(before !== undefined ? { before } : {}),
    ...(actorUserId !== 'all' ? { actorUserId } : {}),
    ...(eventType.trim().length > 0 ? { eventType: eventType.trim() } : {}),
    ...(search.length > 0 ? { search } : {}),
  });

  const rows = useMemo(
    () =>
      [...older, ...(feed.data?.rows ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [older, feed.data],
  );

  function loadMore() {
    const last = rows[rows.length - 1];
    if (last === undefined) return;
    setOlder(rows);
    setBefore(new Date(last.createdAt).toISOString());
  }

  const filterDefs: FilterDef[] = [
    {
      key: 'module',
      label: t('filters.module'),
      control: {
        kind: 'select',
        value: module,
        onValueChange: (v) => setModule(v as ModuleFilter),
        options: MODULES.map((m) => ({ value: m, label: t(`modules.${m}` as never) })),
      },
    },
    {
      key: 'user',
      label: t('filters.user'),
      control: {
        kind: 'select',
        value: actorUserId,
        onValueChange: setActorUserId,
        options: [
          { value: 'all', label: t('allUsers') },
          ...(users.data?.users ?? []).map((u) => ({ value: u.id, label: u.name ?? u.id })),
        ],
      },
    },
    {
      key: 'eventType',
      label: t('filters.eventType'),
      control: {
        kind: 'custom',
        render: () => (
          <input
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            placeholder={t('eventTypePlaceholder')}
            className="w-32 border-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            aria-label={t('filters.eventType')}
          />
        ),
      },
    },
  ];
  const activeKeys = filterDefs.map((f) => f.key).filter((k) => activeFilters.has(k));

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <FilterBar
        search={{
          value: searchInput,
          onChange: setSearchInput,
          placeholder: t('searchPlaceholder'),
        }}
        filters={filterDefs}
        activeKeys={activeKeys}
        onAddFilter={(k) => setActiveFilters((prev) => new Set(prev).add(k))}
        onRemoveFilter={(k) => {
          setActiveFilters((prev) => {
            const next = new Set(prev);
            next.delete(k);
            return next;
          });
          if (k === 'module') setModule('all');
          if (k === 'user') setActorUserId('all');
          if (k === 'eventType') setEventType('');
        }}
      />

      <Card>
        <CardContent className="p-0">
          {feed.isLoading && rows.length === 0 ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">{t('columns.when')}</th>
                    <th className="px-3 py-1.5 font-medium">{t('columns.module')}</th>
                    <th className="px-3 py-1.5 font-medium">{t('columns.event')}</th>
                    <th className="px-3 py-1.5 font-medium">{t('columns.actor')}</th>
                    <th className="px-3 py-1.5 font-medium">{t('columns.detail')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.module}-${r.entityId}-${i}`} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                        {formatDateTime(r.createdAt, locale)}
                      </td>
                      <td className="px-3 py-1.5">{t(`modules.${r.module}` as never)}</td>
                      <td className="px-3 py-1.5 font-medium">{r.kind.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-1.5">{r.actorName ?? t('systemActor')}</td>
                      <td className="max-w-md truncate px-3 py-1.5 text-muted-foreground">
                        {r.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {feed.data?.hasMore === true ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={feed.isFetching}>
            {t('loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
