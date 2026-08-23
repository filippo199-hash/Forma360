'use client';
import {
  AlertTriangle,
  Archive,
  Building2,
  ChevronRight,
  ListChecks,
  MapPin,
  Plus,
  RotateCcw,
  Search,
  Users,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../src/components/ui/dialog';
import { Input } from '../../../src/components/ui/input';
import { Label } from '../../../src/components/ui/label';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { cn } from '../../../src/lib/cn';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { hubTitleKey, usePlaceTerms } from '../../../src/lib/terminology';
import { trpc } from '../../../src/lib/trpc/client';
import { useServerErrorToast } from '../../../src/lib/use-server-error';

type Kind = 'site' | 'project';
type Status = 'planning' | 'active' | 'on_hold' | 'completed';
type SortKey = 'recent' | 'name' | 'deadline';

const STATUS_COLORS: Record<Status, string> = {
  planning: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  on_hold: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
};

const SELECT_CLS =
  'h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

/** Rough day count from a YYYY-MM-DD string to today (local midnight). */
function daysUntil(dateStr: string): number {
  const target = new Date(`${dateStr}T00:00:00`).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}

export default function SitesHubPage() {
  const t = useTranslations('sites');
  const tCommon = useTranslations('common');
  const onServerError = useServerErrorToast(tCommon('error'));
  const format = useFormatter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('sites.manage');
  const { term: terminology, place, places } = usePlaceTerms();
  const defaultKind: Kind = terminology === 'sites' ? 'site' : 'project';
  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.sites.hub.useQuery();
  const rows = data ?? [];

  // ── View + filters ────────────────────────────────────────────────
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [kindFilter, setKindFilter] = useState<'all' | Kind>('all');
  const [sort, setSort] = useState<SortKey>('recent');

  const archivedCount = rows.filter((r) => r.archivedAt !== null).length;
  const filtersActive =
    search.trim() !== '' ||
    statusFilter !== 'all' ||
    (terminology === 'both' && kindFilter !== 'all');

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows.filter((r) =>
      view === 'archived' ? r.archivedAt !== null : r.archivedAt === null,
    );
    if (q !== '') {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.client !== null && r.client.toLowerCase().includes(q)),
      );
    }
    if (statusFilter !== 'all') list = list.filter((r) => r.status === statusFilter);
    if (terminology === 'both' && kindFilter !== 'all') {
      list = list.filter((r) =>
        kindFilter === 'project' ? r.kind === 'project' : r.kind !== 'project',
      );
    }
    const sorted = [...list];
    if (sort === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'deadline') {
      sorted.sort((a, b) => {
        const av = a.endDate ?? '9999-12-31';
        const bv = b.endDate ?? '9999-12-31';
        return av.localeCompare(bv);
      });
    } else {
      sorted.sort((a, b) => {
        const at = a.updatedAt !== null ? new Date(a.updatedAt).getTime() : 0;
        const bt = b.updatedAt !== null ? new Date(b.updatedAt).getTime() : 0;
        return bt - at;
      });
    }
    return sorted;
  }, [rows, view, search, statusFilter, kindFilter, sort, terminology]);

  // ── Hierarchy tree (default browse mode) ─────────────────────────
  // Children nest under their parent with indent guides; searching or
  // filtering switches to the flat card grid because matches can sit in
  // different branches. Collapsed state is per node.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const treeMode = !filtersActive;
  const byParent = useMemo(() => {
    const idSet = new Set(visible.map((r) => r.id));
    const m = new Map<string | null, typeof visible>();
    for (const r of visible) {
      // A child whose parent isn't in this view (e.g. active child of an
      // archived parent) renders as a root — its card keeps the "in X" hint.
      const key = r.parentId !== null && idSet.has(r.parentId) ? r.parentId : null;
      const list = m.get(key) ?? [];
      list.push(r);
      m.set(key, list);
    }
    return m;
  }, [visible]);

  function toggleCollapsed(id: string): void {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Create dialog ─────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('project');
  const [client, setClient] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [parentId, setParentId] = useState('');

  function openCreate() {
    setKind(defaultKind);
    setOpen(true);
  }

  // NR3-03: Cancel/Escape must not keep the typed text for the next open.
  function resetCreateForm() {
    setName('');
    setClient('');
    setStatus('active');
    setStartDate('');
    setEndDate('');
    setParentId('');
  }

  function closeCreate() {
    resetCreateForm();
    setOpen(false);
  }

  const create = trpc.sites.create.useMutation({
    onSuccess: () => {
      toast.success(t('createdToast'));
      void utils.sites.hub.invalidate();
      closeCreate();
    },
    onError: onServerError,
  });

  const restore = trpc.sites.restore.useMutation({
    onSuccess: () => {
      toast.success(t('restoredToast'));
      void utils.sites.hub.invalidate();
    },
    onError: onServerError,
  });

  const dateOrderError =
    kind === 'project' && startDate !== '' && endDate !== '' && endDate < startDate;

  function submit() {
    if (name.trim().length === 0) return;
    if (dateOrderError) return;
    create.mutate({
      name: name.trim(),
      kind,
      ...(parentId !== '' ? { parentId } : {}),
      ...(kind === 'project'
        ? {
            status,
            client: client.trim() === '' ? null : client.trim(),
            startDate: startDate === '' ? null : startDate,
            endDate: endDate === '' ? null : endDate,
          }
        : {}),
    });
  }

  function statusLabel(s: string | null): string | null {
    if (s === 'planning' || s === 'active' || s === 'on_hold' || s === 'completed') {
      return t(`status_${s}` as 'status_active');
    }
    return null;
  }

  // ── Card ──────────────────────────────────────────────────────────
  function renderCard(row: (typeof rows)[number]) {
    const isProject = row.kind === 'project';
    const label = statusLabel(row.status);
    const isArchived = row.archivedAt !== null;

    // Timeline health (projects with an end date).
    let bar: { pct: number; text: string; tone: 'overdue' | 'done' | 'normal' } | null = null;
    if (isProject && row.status !== 'completed' && row.endDate !== null) {
      const left = daysUntil(row.endDate);
      let pct = 0;
      if (row.startDate !== null) {
        const total = daysUntil(row.endDate) - daysUntil(row.startDate);
        const done = -daysUntil(row.startDate);
        pct = total > 0 ? Math.min(100, Math.max(0, Math.round((done / total) * 100))) : 0;
      }
      bar =
        left < 0
          ? { pct: 100, text: t('timelineOverdue'), tone: 'overdue' }
          : { pct, text: t('timelineDaysLeft', { count: left }), tone: 'normal' };
    } else if (isProject && row.status === 'completed') {
      bar = { pct: 100, text: t('timelineComplete'), tone: 'done' };
    }

    const inner = (
      <Card
        className={cn(
          'h-full transition-colors',
          isArchived ? 'opacity-70' : 'hover:border-primary/50 hover:bg-muted/30',
        )}
      >
        <CardContent className="space-y-3 p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 font-medium">
              {isProject ? (
                <MapPin className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate leading-snug" title={row.name}>
                {row.name}
              </span>
            </div>
            {label !== null ? (
              <span
                className={cn(
                  'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium',
                  STATUS_COLORS[row.status as Status] ?? STATUS_COLORS.active,
                )}
              >
                {label}
              </span>
            ) : null}
          </div>

          {/* Hierarchy at a glance — child sites show their parent. */}
          {row.parentName !== null ? (
            <p
              className="truncate text-xs text-muted-foreground"
              title={t('inParent', { name: row.parentName })}
            >
              {t('inParent', { name: row.parentName })}
            </p>
          ) : null}

          {row.client !== null && row.client !== '' ? (
            <p className="truncate text-sm text-muted-foreground" title={row.client}>
              {row.client}
            </p>
          ) : null}

          {bar !== null ? (
            <div className="space-y-1">
              {/* Explicit "Timeline" label — the bar tracks elapsed calendar
                  time between start/end dates, NOT work completion. */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-medium">{t('timelineLabel')}</span>
                {bar.tone === 'normal' ? (
                  <span>{t('timelineElapsed', { pct: bar.pct })}</span>
                ) : null}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full',
                    bar.tone === 'overdue'
                      ? 'bg-red-500'
                      : bar.tone === 'done'
                        ? 'bg-blue-500'
                        : 'bg-primary',
                  )}
                  style={{ width: `${bar.pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className={bar.tone === 'overdue' ? 'font-medium text-red-600' : undefined}>
                  {bar.text}
                </span>
                {row.endDate !== null ? (
                  <span>
                    {format.dateTime(new Date(`${row.endDate}T00:00:00`), { dateStyle: 'medium' })}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Health chips */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {row.openObservations > 0 ? (
              <span className="inline-flex items-center gap-1" title={t('countObservations')}>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                {row.openObservations}
              </span>
            ) : null}
            {row.openActions > 0 ? (
              <span className="inline-flex items-center gap-1" title={t('countActions')}>
                <ListChecks className="h-3.5 w-3.5 text-sky-500" />
                {row.openActions}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1" title={t('countMembers')}>
              <Users className="h-3.5 w-3.5" />
              {row.memberCount}
            </span>
            {row.openObservations === 0 && row.openActions === 0 && !isArchived ? (
              <span className="text-muted-foreground/70">{t('openItemsNone')}</span>
            ) : null}
          </div>

          {isArchived && canManage ? (
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                disabled={restore.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  restore.mutate({ id: row.id });
                }}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                {t('restoreButton')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    );

    return (
      <Link key={row.id} href={`/${locale}/sites/${row.id}`} className="block">
        {inner}
      </Link>
    );
  }

  // ── Tree rows ─────────────────────────────────────────────────────
  function renderTreeNodes(parentKey: string | null): React.ReactNode {
    const nodes = byParent.get(parentKey) ?? [];
    return nodes.map((row) => {
      const kids = byParent.get(row.id) ?? [];
      const isCollapsed = collapsedIds.has(row.id);
      const isProject = row.kind === 'project';
      const isArchived = row.archivedAt !== null;
      const label = statusLabel(row.status);
      const timelineText =
        isProject && row.status === 'completed'
          ? t('timelineComplete')
          : isProject && row.endDate !== null
            ? daysUntil(row.endDate) < 0
              ? t('timelineOverdue')
              : t('timelineDaysLeft', { count: daysUntil(row.endDate) })
            : null;

      return (
        <div key={row.id}>
          <div
            className={cn(
              'group flex items-center gap-1.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-muted/40',
              isArchived && 'opacity-70',
            )}
          >
            {kids.length > 0 ? (
              <button
                type="button"
                onClick={() => toggleCollapsed(row.id)}
                aria-label={
                  isCollapsed
                    ? t('treeExpand', { name: row.name })
                    : t('treeCollapse', { name: row.name })
                }
                aria-expanded={!isCollapsed}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronRight
                  className={cn('h-4 w-4 transition-transform', !isCollapsed && 'rotate-90')}
                />
              </button>
            ) : (
              <span className="h-6 w-6 shrink-0" aria-hidden />
            )}
            {isProject ? (
              <MapPin className="h-4 w-4 shrink-0 text-primary" />
            ) : (
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <Link
              href={`/${locale}/sites/${row.id}`}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-0.5"
            >
              <span className="truncate text-sm font-medium" title={row.name}>
                {row.name}
              </span>
              {label !== null ? (
                <span
                  className={cn(
                    'shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium',
                    STATUS_COLORS[row.status as Status] ?? STATUS_COLORS.active,
                  )}
                >
                  {label}
                </span>
              ) : null}
              {kids.length > 0 && isCollapsed ? (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {kids.length}
                </span>
              ) : null}
              <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                {row.client !== null && row.client !== '' ? (
                  <span className="hidden max-w-36 truncate sm:inline" title={row.client}>
                    {row.client}
                  </span>
                ) : null}
                {timelineText !== null ? (
                  <span className="hidden sm:inline">{timelineText}</span>
                ) : null}
                {row.openObservations > 0 ? (
                  <span className="inline-flex items-center gap-1" title={t('countObservations')}>
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    {row.openObservations}
                  </span>
                ) : null}
                {row.openActions > 0 ? (
                  <span className="inline-flex items-center gap-1" title={t('countActions')}>
                    <ListChecks className="h-3.5 w-3.5 text-sky-500" />
                    {row.openActions}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1" title={t('countMembers')}>
                  <Users className="h-3.5 w-3.5" />
                  {row.memberCount}
                </span>
              </span>
            </Link>
            {isArchived && canManage ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                disabled={restore.isPending}
                onClick={() => restore.mutate({ id: row.id })}
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                {t('restoreButton')}
              </Button>
            ) : null}
          </div>
          {kids.length > 0 && !isCollapsed ? (
            <div className="ml-[19px] border-l border-border pl-2.5">{renderTreeNodes(row.id)}</div>
          ) : null}
        </div>
      );
    });
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t(hubTitleKey(terminology))}</h1>
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
            {t('subtitle', { places })}
          </p>
        </div>
        {canManage ? (
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            {t('newButton')}
          </Button>
        ) : null}
      </header>

      {/* Active / Archived tabs (platform underline style) */}
      <div className="border-b border-slate-300 dark:border-slate-700">
        <nav className="flex gap-1">
          {(['active', 'archived'] as const).map((v) => {
            const active = view === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors',
                  active
                    ? 'border-[#234fe1] font-medium text-[#234fe1]'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {v === 'active' ? t('viewActive') : t('viewArchived')}
                {v === 'archived' && archivedCount > 0 ? (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {archivedCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Toolbar: search + filters + sort */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-9 pl-8"
          />
        </div>
        {terminology === 'both' ? (
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as 'all' | Kind)}
            className={SELECT_CLS}
            aria-label={t('kindAll')}
          >
            <option value="all">{t('kindAll')}</option>
            <option value="project">{t('kindProject')}</option>
            <option value="site">{t('kindSite')}</option>
          </select>
        ) : null}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | Status)}
          className={SELECT_CLS}
          aria-label={t('filterAllStatuses')}
        >
          <option value="all">{t('filterAllStatuses')}</option>
          <option value="planning">{t('status_planning')}</option>
          <option value="active">{t('status_active')}</option>
          <option value="on_hold">{t('status_on_hold')}</option>
          <option value="completed">{t('status_completed')}</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className={SELECT_CLS}
          aria-label={t('sortLabel')}
        >
          <option value="recent">{t('sortRecent')}</option>
          <option value="name">{t('sortName')}</option>
          <option value="deadline">{t('sortDeadline')}</option>
        </select>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : error !== null ? (
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6 text-red-500" />}
          text={t('loadError')}
        />
      ) : view === 'archived' && visible.length === 0 ? (
        <EmptyState icon={<Archive className="h-6 w-6" />} text={t('noArchived')} />
      ) : visible.length === 0 ? (
        rows.filter((r) => r.archivedAt === null).length === 0 ? (
          <EmptyState
            icon={<MapPin className="h-6 w-6" />}
            text={t('empty', { places })}
            action={
              canManage ? (
                <Button onClick={openCreate}>
                  <Plus className="mr-1 h-4 w-4" />
                  {t('newButton')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <EmptyState icon={<MapPin className="h-6 w-6" />} text={t('noResults')} />
        )
      ) : treeMode ? (
        /* Hierarchy view — children indent under their parent with guide
           lines; chevrons collapse whole branches. */
        <Card>
          <CardContent className="p-2">{renderTreeNodes(null)}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visible.map(renderCard)}</div>
      )}

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : closeCreate())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dialogTitle', { place })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Always ask the kind — with a one-line explanation of each — so
                users understand why some cards carry client/timeline/status
                and others don't. */}
            <div className="space-y-1.5">
              <Label>{t('fieldKind')}</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(['project', 'site'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    aria-pressed={kind === k}
                    className={cn(
                      'rounded-md border px-3 py-2 text-left transition-colors',
                      kind === k
                        ? 'border-primary bg-primary/5'
                        : 'border-input hover:border-muted-foreground/40',
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {k === 'project' ? (
                        <MapPin className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      {k === 'project' ? t('kindProject') : t('kindSite')}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {k === 'project' ? t('kindProjectHelp') : t('kindSiteHelp')}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="site-name">{t('fieldName')}</Label>
              <Input
                id="site-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
                maxLength={120}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="site-parent">{t('fieldParent')}</Label>
              <select
                id="site-parent"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">{t('parentNone')}</option>
                {rows
                  .filter((r) => r.archivedAt === null)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </div>

            {kind === 'project' ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="site-client">{t('fieldClient')}</Label>
                  <Input
                    id="site-client"
                    value={client}
                    onChange={(e) => setClient(e.target.value)}
                    placeholder={t('clientPlaceholder')}
                    maxLength={200}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="site-start">{t('fieldStart')}</Label>
                    <Input
                      id="site-start"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="site-end">{t('fieldEnd')}</Label>
                    <Input
                      id="site-end"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      aria-invalid={dateOrderError}
                    />
                  </div>
                </div>
                {dateOrderError ? (
                  <p className="text-sm text-red-600">{t('dateOrderError')}</p>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor="site-status">{t('fieldStatus')}</Label>
                  <select
                    id="site-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Status)}
                    className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="planning">{t('status_planning')}</option>
                    <option value="active">{t('status_active')}</option>
                    <option value="on_hold">{t('status_on_hold')}</option>
                    <option value="completed">{t('status_completed')}</option>
                  </select>
                </div>
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeCreate}>
              {tCommon('cancel')}
            </Button>
            <Button
              onClick={submit}
              disabled={create.isPending || name.trim().length === 0 || dateOrderError}
            >
              {t('createButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  icon,
  text,
  action,
}: {
  icon: React.ReactNode;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
        {icon}
        <p>{text}</p>
        {action !== undefined ? <div className="mt-2">{action}</div> : null}
      </CardContent>
    </Card>
  );
}
