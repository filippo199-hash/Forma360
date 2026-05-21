'use client';

import {
  ChevronDown,
  Columns3,
  Filter,
  List as ListIcon,
  Plus,
  Search as SearchIcon,
  Settings2,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
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
type FilterKey = 'status' | 'source' | 'priority' | 'assignedToMe' | 'overdue' | 'hideClosed' | 'archived' | 'sort';

const FILTER_KEYS: ReadonlyArray<FilterKey> = [
  'status',
  'source',
  'priority',
  'assignedToMe',
  'overdue',
  'hideClosed',
  'archived',
  'sort',
];

const STATUSES: ReadonlyArray<StatusFilter> = ['all', 'open', 'in_progress', 'completed', 'cancelled'];
const SOURCES: ReadonlyArray<SourceFilter> = ['all', 'standalone', 'inspection', 'issue'];
const PRIORITIES: ReadonlyArray<PriorityFilter> = ['all', 'critical', 'high', 'medium', 'low'];
const SORT_OPTIONS: ReadonlyArray<SortBy> = ['created', 'due', 'priority', 'updated'];
const BOARD_COLUMNS: ReadonlyArray<Exclude<StatusFilter, 'all'>> = [
  'open',
  'in_progress',
  'completed',
  'cancelled',
];

const STATUS_COLUMN_COLORS: Record<Exclude<StatusFilter, 'all'>, string> = {
  open: 'border-l-blue-400',
  in_progress: 'border-l-amber-400',
  completed: 'border-l-emerald-400',
  cancelled: 'border-l-slate-400',
};

/**
 * Actions page — board-first with composable "Add filter" chip system.
 *
 * The filter bar is collapsed into an "Add filter" button; active filters
 * render as dismissible chips so the toolbar stays uncluttered. The view
 * defaults to Board. A "Categories" shortcut in the header takes admins
 * to the action-type management page without navigating to Settings.
 */
export default function ActionsListPage() {
  const t = useTranslations('actions.list');
  const tStatus = useTranslations('actions.status');
  const tPriority = useTranslations('actions.priority');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canCreate = useHasPermission('actions.create');
  const canSettings = useHasPermission('actions.settings');

  // View state — defaults to board
  const [view, setView] = useState<ViewMode>('board');

  // Filter values
  const [status, setStatus] = useState<StatusFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [priority, setPriority] = useState<PriorityFilter>('all');
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [hideClosed, setHideClosed] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('created');
  const [query, setQuery] = useState('');

  // Which filter chips are currently visible (sort is always shown)
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set(['sort']));
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  // Close filter menu on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setFilterMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function addFilter(key: FilterKey) {
    setActiveFilters((prev) => new Set([...prev, key]));
    setFilterMenuOpen(false);
  }

  function removeFilter(key: FilterKey) {
    if (key === 'sort') return; // sort chip is permanent
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    switch (key) {
      case 'status': setStatus('all'); break;
      case 'source': setSource('all'); break;
      case 'priority': setPriority('all'); break;
      case 'assignedToMe': setAssignedToMe(false); break;
      case 'overdue': setOverdueOnly(false); break;
      case 'hideClosed': setHideClosed(false); break;
      case 'archived': setIncludeArchived(false); break;
    }
  }

  function clearAllFilters() {
    setActiveFilters(new Set(['sort']));
    setStatus('all');
    setSource('all');
    setPriority('all');
    setAssignedToMe(false);
    setOverdueOnly(false);
    setHideClosed(false);
    setIncludeArchived(false);
    setSortBy('created');
    setQuery('');
  }

  const availableFilterKeys = FILTER_KEYS.filter((k) => !activeFilters.has(k) && k !== 'sort');
  const nonDefaultFiltersCount =
    (status !== 'all' ? 1 : 0) +
    (source !== 'all' ? 1 : 0) +
    (priority !== 'all' ? 1 : 0) +
    (assignedToMe ? 1 : 0) +
    (overdueOnly ? 1 : 0) +
    (hideClosed ? 1 : 0) +
    (includeArchived ? 1 : 0) +
    (query.trim().length > 0 ? 1 : 0);

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

  // Label for a filter chip header
  function filterLabel(key: FilterKey): string {
    const labels: Record<FilterKey, string> = {
      status: t('filterStatus'),
      source: t('filterSource'),
      priority: t('filterPriority'),
      assignedToMe: t('filterAssigneeMe'),
      overdue: t('overdueChip'),
      hideClosed: t('hideClosed'),
      archived: t('showArchived'),
      sort: t('sortLabel'),
    };
    return labels[key];
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {canSettings ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/${locale}/actions/categories`}>
                <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                {t('categoriesButton')}
              </Link>
            </Button>
          ) : null}
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

      {/* Search + filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative min-w-[200px]">
          <SearchIcon
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="pl-8"
            aria-label={t('searchLabel')}
          />
        </div>

        {/* Add filter button */}
        <div className="relative" ref={filterMenuRef}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFilterMenuOpen((v) => !v)}
            className="gap-1.5"
          >
            <Filter className="h-3.5 w-3.5" />
            {t('addFilter')}
            {nonDefaultFiltersCount > 0 ? (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {nonDefaultFiltersCount}
              </span>
            ) : (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            )}
          </Button>

          {filterMenuOpen && availableFilterKeys.length > 0 ? (
            <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-md border bg-popover py-1 shadow-lg">
              {availableFilterKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => addFilter(key)}
                  className="flex w-full items-center px-3 py-2 text-sm hover:bg-accent"
                >
                  {filterLabel(key)}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Active filter chips */}
        {activeFilters.has('sort') ? (
          <FilterChip label={t('sortLabel')} removable={false} onRemove={() => removeFilter('sort')}>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="border-0 bg-transparent text-xs outline-none"
            >
              {SORT_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(`sortBy.${s}`)}
                </option>
              ))}
            </select>
          </FilterChip>
        ) : null}

        {activeFilters.has('status') && view === 'list' ? (
          <FilterChip label={t('filterStatus')} removable onRemove={() => removeFilter('status')}>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className="border-0 bg-transparent text-xs outline-none"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? t('filterStatusAll') : tStatus(s)}
                </option>
              ))}
            </select>
          </FilterChip>
        ) : null}

        {activeFilters.has('source') ? (
          <FilterChip label={t('filterSource')} removable onRemove={() => removeFilter('source')}>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as SourceFilter)}
              className="border-0 bg-transparent text-xs outline-none"
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
            </select>
          </FilterChip>
        ) : null}

        {activeFilters.has('priority') ? (
          <FilterChip label={t('filterPriority')} removable onRemove={() => removeFilter('priority')}>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as PriorityFilter)}
              className="border-0 bg-transparent text-xs outline-none"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p === 'all' ? t('filterPriorityAll') : tPriority(p)}
                </option>
              ))}
            </select>
          </FilterChip>
        ) : null}

        {activeFilters.has('assignedToMe') ? (
          <FilterChip
            label={t('filterAssigneeMe')}
            removable
            onRemove={() => removeFilter('assignedToMe')}
            active={assignedToMe}
            onToggle={() => setAssignedToMe((v) => !v)}
          />
        ) : null}

        {activeFilters.has('overdue') ? (
          <FilterChip
            label={t('overdueChip')}
            removable
            onRemove={() => removeFilter('overdue')}
            active={overdueOnly}
            onToggle={() => setOverdueOnly((v) => !v)}
          />
        ) : null}

        {activeFilters.has('hideClosed') && view === 'list' ? (
          <FilterChip
            label={t('hideClosed')}
            removable
            onRemove={() => removeFilter('hideClosed')}
            active={hideClosed}
            onToggle={() => setHideClosed((v) => !v)}
          />
        ) : null}

        {activeFilters.has('archived') ? (
          <FilterChip
            label={t('showArchived')}
            removable
            onRemove={() => removeFilter('archived')}
            active={includeArchived}
            onToggle={() => setIncludeArchived((v) => !v)}
          />
        ) : null}

        {nonDefaultFiltersCount > 0 ? (
          <button
            type="button"
            onClick={clearAllFilters}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            {t('clearFilters')}
          </button>
        ) : null}
      </div>

      {/* Content */}
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

/** A filter chip — either a select wrapper or a toggleable boolean pill. */
function FilterChip({
  label,
  removable,
  onRemove,
  active,
  onToggle,
  children,
}: {
  label: string;
  removable: boolean;
  onRemove: () => void;
  active?: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
        active === true
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-input bg-background text-foreground',
      )}
    >
      <span className="font-medium text-muted-foreground">{label}:</span>
      {children !== undefined ? (
        children
      ) : (
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'font-medium',
            active === true ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {active === true ? 'On' : 'Off'}
        </button>
      )}
      {removable ? (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Remove ${label} filter`}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
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
              <th className="px-3 py-2 font-medium">{t('columns.type')}</th>
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
                <td colSpan={8} className="p-4">
                  <Skeleton className="h-4 w-full" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted-foreground">
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
                      {row.recurrence !== null && row.recurrence !== undefined ? (
                        <span
                          className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-blue-700 dark:bg-blue-950 dark:text-blue-200"
                          title={t('recurringBadge')}
                        >
                          {t('recurringBadge')}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {row.actionTypeName !== null ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground">
                          {row.actionTypeColor !== null && row.actionTypeColor.length > 0 ? (
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: row.actionTypeColor }}
                              aria-hidden="true"
                            />
                          ) : null}
                          {row.actionTypeName}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
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
              // Full-height kanban column: fills the viewport below the
              // header/filters chrome, with internal scroll so a column
              // with many cards doesn't push the whole page down.
              'flex h-[calc(100vh-15rem)] min-h-[400px] flex-col gap-2 overflow-hidden rounded-md border-l-4 bg-muted/30 p-3',
              STATUS_COLUMN_COLORS[col],
            )}
          >
            {/* Column header — stays pinned at the top of the column */}
            <div className="flex shrink-0 items-center justify-between px-1">
              <h2 className="text-sm font-semibold">{tStatus(col)}</h2>
              <span className="text-xs text-muted-foreground" aria-label={t('boardCountAria')}>
                {rows.length}
              </span>
            </div>
            {/* Cards — scroll internally when the column overflows */}
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
              {rows.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                  {t('boardColumnEmpty')}
                </p>
              ) : (
                rows.map((row) => (
                  <BoardCard key={row.id} row={row} locale={locale} tPriority={tPriority} t={t} />
                ))
              )}
            </div>
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
      {row.actionTypeName !== null || row.recurrence !== null ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {row.actionTypeName !== null ? (
            <span className="inline-flex items-center gap-1 rounded-full border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {row.actionTypeColor !== null && row.actionTypeColor.length > 0 ? (
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: row.actionTypeColor }}
                  aria-hidden="true"
                />
              ) : null}
              {row.actionTypeName}
            </span>
          ) : null}
          {row.recurrence !== null ? (
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-blue-700 dark:bg-blue-950 dark:text-blue-200">
              {t('recurringBadge')}
            </span>
          ) : null}
        </div>
      ) : null}
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
        <span className="text-muted-foreground">{row.assigneeName ?? t('noAssignee')}</span>
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
  actionTypeId: string | null;
  actionTypeName: string | null;
  actionTypeColor: string | null;
  recurrence: unknown;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  assigneeName: string | null;
}
