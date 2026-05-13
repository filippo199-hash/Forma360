'use client';

import { Columns3, List as ListIcon, Plus, Search as SearchIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Input } from '../../../src/components/ui/input';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { cn } from '../../../src/lib/cn';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';

type StatusFilter = 'all' | 'open' | 'in_progress' | 'completed' | 'cancelled';
type SourceFilter = 'all' | 'standalone' | 'inspection' | 'issue';
type PriorityFilter = 'all' | 'low' | 'medium' | 'high' | 'critical';
type SortBy = 'created' | 'due' | 'priority' | 'updated';
type ViewMode = 'list' | 'board';

const STATUSES: ReadonlyArray<StatusFilter> = [
  'all',
  'open',
  'in_progress',
  'completed',
  'cancelled',
];
const SOURCES: ReadonlyArray<SourceFilter> = ['all', 'standalone', 'inspection', 'issue'];
const PRIORITIES: ReadonlyArray<PriorityFilter> = ['all', 'critical', 'high', 'medium', 'low'];
const SORT_OPTIONS: ReadonlyArray<SortBy> = ['created', 'due', 'priority', 'updated'];
const BOARD_COLUMNS: ReadonlyArray<Exclude<StatusFilter, 'all'>> = [
  'open',
  'in_progress',
  'completed',
  'cancelled',
];

/**
 * Actions list page (Phase 4 build, expanded with SafetyCulture parity).
 *
 * Toolbar: search + status / source / priority / assigned-to-me /
 * overdue / hide-closed / show-archived chips + sort selector + List /
 * Board view toggle. Standalone, inspection-raised and observation-
 * raised actions all share the same list — the `Source` column
 * distinguishes them.
 *
 * Routes: `/actions` (this page) → `/actions/new` (standalone create)
 * → `/actions/[actionId]` (detail).
 */
export default function ActionsListPage() {
  const t = useTranslations('actions.list');
  const tStatus = useTranslations('actions.status');
  const tPriority = useTranslations('actions.priority');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canCreate = useHasPermission('actions.create');

  const [view, setView] = useState<ViewMode>('list');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [priority, setPriority] = useState<PriorityFilter>('all');
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [hideClosed, setHideClosed] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('created');
  const [query, setQuery] = useState('');

  const listInput: {
    status?: Exclude<StatusFilter, 'all'>;
    sourceType?: Exclude<SourceFilter, 'all'>;
    priority?: Exclude<PriorityFilter, 'all'>;
    assignedToMe: boolean;
    overdueOnly: boolean;
    includeArchived: boolean;
    hideClosed: boolean;
    sortBy: SortBy;
    query?: string;
  } = {
    assignedToMe,
    overdueOnly,
    includeArchived,
    hideClosed: view === 'board' ? false : hideClosed,
    sortBy,
  };
  if (status !== 'all' && view === 'list') listInput.status = status;
  if (source !== 'all') listInput.sourceType = source;
  if (priority !== 'all') listInput.priority = priority;
  if (query.trim().length > 0) listInput.query = query.trim();

  const { data: rows, isLoading } = trpc.actions.list.useQuery(listInput);
  const list = useMemo(() => rows ?? [], [rows]);

  const grouped = useMemo(() => {
    const acc: Record<Exclude<StatusFilter, 'all'>, typeof list> = {
      open: [],
      in_progress: [],
      completed: [],
      cancelled: [],
    };
    for (const row of list) {
      const key = row.status as Exclude<StatusFilter, 'all'>;
      if (key in acc) acc[key].push(row);
    }
    return acc;
  }, [list]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle view={view} onChange={setView} t={t} />
          {canCreate ? (
            <Button asChild>
              <Link href={`/${locale}/actions/new`}>
                <Plus className="mr-1 h-4 w-4" />
                {t('newButton')}
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="action-search" className="text-xs font-medium text-muted-foreground">
            {t('searchLabel')}
          </label>
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="action-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="pl-8"
            />
          </div>
        </div>

        {view === 'list' ? (
          <Select
            id="filter-status"
            label={t('filterStatus')}
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? t('filterStatusAll') : tStatus(s)}
              </option>
            ))}
          </Select>
        ) : null}

        <Select
          id="filter-source"
          label={t('filterSource')}
          value={source}
          onChange={(v) => setSource(v as SourceFilter)}
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s === 'all'
                ? t('filterSourceAll')
                : s === 'standalone'
                ? t('filterSourceStandalone')
                : s === 'inspection'
                ? t('filterSourceInspection')
                : t('filterSourceIssue')}
            </option>
          ))}
        </Select>

        <Select
          id="filter-priority"
          label={t('filterPriority')}
          value={priority}
          onChange={(v) => setPriority(v as PriorityFilter)}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p === 'all' ? t('filterPriorityAll') : tPriority(p)}
            </option>
          ))}
        </Select>

        <Select
          id="sort-by"
          label={t('sortLabel')}
          value={sortBy}
          onChange={(v) => setSortBy(v as SortBy)}
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`sortBy.${s}`)}
            </option>
          ))}
        </Select>

        <Toggle checked={assignedToMe} onChange={setAssignedToMe} label={t('filterAssigneeMe')} />
        <Toggle checked={overdueOnly} onChange={setOverdueOnly} label={t('overdueChip')} />
        {view === 'list' ? (
          <Toggle checked={hideClosed} onChange={setHideClosed} label={t('hideClosed')} />
        ) : null}
        <Toggle checked={includeArchived} onChange={setIncludeArchived} label={t('showArchived')} />
      </div>

      {view === 'list' ? (
        <ListView
          rows={list}
          isLoading={isLoading}
          locale={locale}
          canCreate={canCreate}
          tStatus={(k) => tStatus(k)}
          tPriority={(k) => tPriority(k)}
          t={t}
        />
      ) : (
        <BoardView
          grouped={grouped}
          isLoading={isLoading}
          locale={locale}
          tStatus={(k) => tStatus(k)}
          tPriority={(k) => tPriority(k)}
          t={t}
        />
      )}
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
  t,
}: {
  view: 'list' | 'board';
  onChange: (v: 'list' | 'board') => void;
  t: (k: string) => string;
}) {
  return (
    <div
      role="tablist"
      aria-label={t('viewToggleLabel')}
      className="inline-flex items-center rounded-md border border-input bg-background p-0.5"
    >
      <button
        type="button"
        role="tab"
        aria-selected={view === 'list'}
        onClick={() => onChange('list')}
        className={cn(
          'inline-flex items-center gap-1 rounded px-2 py-1 text-sm',
          view === 'list'
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <ListIcon className="h-3.5 w-3.5" />
        {t('viewList')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'board'}
        onClick={() => onChange('board')}
        className={cn(
          'inline-flex items-center gap-1 rounded px-2 py-1 text-sm',
          view === 'board'
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Columns3 className="h-3.5 w-3.5" />
        {t('viewBoard')}
      </button>
    </div>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        {children}
      </select>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4"
      />
      <span>{label}</span>
    </label>
  );
}

function ListView({
  rows,
  isLoading,
  locale,
  canCreate,
  tStatus,
  tPriority,
  t,
}: {
  rows: ReadonlyArray<ActionRow>;
  isLoading: boolean;
  locale: string;
  canCreate: boolean;
  tStatus: (k: 'open' | 'in_progress' | 'completed' | 'cancelled') => string;
  tPriority: (k: 'low' | 'medium' | 'high' | 'critical') => string;
  t: (k: string) => string;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">{t('columns.reference')}</th>
              <th className="px-3 py-2 font-medium">{t('columns.title')}</th>
              <th className="px-3 py-2 font-medium">{t('columns.status')}</th>
              <th className="px-3 py-2 font-medium">{t('columns.priority')}</th>
              <th className="px-3 py-2 font-medium">{t('columns.assignee')}</th>
              <th className="px-3 py-2 font-medium">{t('columns.due')}</th>
              <th className="px-3 py-2 font-medium">{t('columns.source')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="p-4">
                  <Skeleton className="h-4 w-full" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  <p>{t('empty')}</p>
                  {canCreate ? (
                    <Link
                      href={`/${locale}/actions/new`}
                      className="mt-2 inline-block text-foreground underline-offset-4 hover:underline"
                    >
                      {t('emptyCta')}
                    </Link>
                  ) : null}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const overdue =
                  row.dueAt !== null &&
                  row.status !== 'completed' &&
                  row.status !== 'cancelled' &&
                  new Date(row.dueAt).getTime() < Date.now();
                return (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      <Link href={`/${locale}/actions/${row.id}`}>
                        {row.referenceNumber ?? row.id.slice(-6)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/${locale}/actions/${row.id}`} className="hover:underline">
                        {row.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.status === 'open' ||
                      row.status === 'in_progress' ||
                      row.status === 'completed' ||
                      row.status === 'cancelled'
                        ? tStatus(row.status)
                        : row.status}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.priority === 'low' ||
                      row.priority === 'medium' ||
                      row.priority === 'high' ||
                      row.priority === 'critical'
                        ? tPriority(row.priority)
                        : t('noPriority')}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.assigneeName ?? t('noAssignee')}
                    </td>
                    <td
                      className={
                        overdue
                          ? 'px-3 py-2 font-medium text-destructive'
                          : 'px-3 py-2 text-muted-foreground'
                      }
                    >
                      {row.dueAt !== null
                        ? new Date(row.dueAt).toLocaleDateString()
                        : t('noDueDate')}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.sourceType === 'inspection'
                        ? t('sourceInspection')
                        : row.sourceType === 'issue'
                        ? t('sourceIssue')
                        : t('sourceStandalone')}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

const STATUS_COLUMN_COLORS: Record<Exclude<StatusFilter, 'all'>, string> = {
  open: 'border-l-blue-400',
  in_progress: 'border-l-amber-400',
  completed: 'border-l-emerald-400',
  cancelled: 'border-l-slate-400',
};

function BoardView({
  grouped,
  isLoading,
  locale,
  tStatus,
  tPriority,
  t,
}: {
  grouped: Record<Exclude<StatusFilter, 'all'>, ReadonlyArray<ActionRow>>;
  isLoading: boolean;
  locale: string;
  tStatus: (k: 'open' | 'in_progress' | 'completed' | 'cancelled') => string;
  tPriority: (k: 'low' | 'medium' | 'high' | 'critical') => string;
  t: (k: string) => string;
}) {
  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {BOARD_COLUMNS.map((col) => {
        const rows = grouped[col];
        return (
          <div
            key={col}
            className={cn(
              'flex min-h-[300px] flex-col gap-2 rounded-md border-l-4 bg-muted/30 p-3',
              STATUS_COLUMN_COLORS[col],
            )}
          >
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold">{tStatus(col)}</h2>
              <span className="text-xs text-muted-foreground" aria-label={t('boardCountAria')}>
                {rows.length}
              </span>
            </div>
            {rows.length === 0 ? (
              <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                {t('boardColumnEmpty')}
              </p>
            ) : (
              rows.map((row) => (
                <BoardCard
                  key={row.id}
                  row={row}
                  locale={locale}
                  tPriority={tPriority}
                  t={t}
                />
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

function BoardCard({
  row,
  locale,
  tPriority,
  t,
}: {
  row: ActionRow;
  locale: string;
  tPriority: (k: 'low' | 'medium' | 'high' | 'critical') => string;
  t: (k: string) => string;
}) {
  const overdue =
    row.dueAt !== null &&
    row.status !== 'completed' &&
    row.status !== 'cancelled' &&
    new Date(row.dueAt).getTime() < Date.now();

  const priorityBadgeClass =
    row.priority === 'critical'
      ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-100'
      : row.priority === 'high'
      ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-100'
      : row.priority === 'medium'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100'
      : row.priority === 'low'
      ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100'
      : '';

  return (
    <Link
      href={`/${locale}/actions/${row.id}`}
      className="block rounded-md bg-card p-3 text-sm shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5">
          {row.sourceType === 'inspection'
            ? t('sourceInspection')
            : row.sourceType === 'issue'
            ? t('sourceIssue')
            : t('sourceStandalone')}
        </span>
        <span className="font-mono">{row.referenceNumber ?? row.id.slice(-6)}</span>
      </div>
      <p className="line-clamp-2 font-medium">{row.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {row.priority === 'low' ||
        row.priority === 'medium' ||
        row.priority === 'high' ||
        row.priority === 'critical' ? (
          <span className={cn('rounded px-1.5 py-0.5 font-medium', priorityBadgeClass)}>
            {tPriority(row.priority)}
          </span>
        ) : null}
        {row.dueAt !== null ? (
          <span className={overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}>
            {new Date(row.dueAt).toLocaleDateString()}
          </span>
        ) : null}
        <span className="text-muted-foreground">
          {row.assigneeName ?? t('noAssignee')}
        </span>
      </div>
    </Link>
  );
}

interface ActionRow {
  id: string;
  referenceNumber: string | null;
  title: string;
  status: string;
  priority: string | null;
  label: string | null;
  assigneeUserId: string | null;
  dueAt: Date | null;
  siteId: string | null;
  sourceType: string;
  sourceId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  assigneeName: string | null;
}
