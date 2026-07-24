'use client';

import {
  Archive,
  ChevronDown,
  FileEdit,
  Filter,
  MoreHorizontal,
  Pencil,
  Search,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArchiveDialog } from '../../../src/components/archive-dialog';
import { SiteFilterChip, useSiteFilterParam } from '../../../src/components/site-filter-chip';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../src/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../src/components/ui/dropdown-menu';
import { Input } from '../../../src/components/ui/input';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { TemplatePickerDialog } from '../../../src/components/inspections/template-picker-dialog';
import { AwaitingSignatureBanner } from '../../../src/components/inspections/awaiting-signature-banner';
import { SectionTabBar } from '../../../src/components/inspections/section-tab-bar';
import { trpc } from '../../../src/lib/trpc/client';

// ─── Shared helpers ────────────────────────────────────────────────────────────

function triggerCsvDownload(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Inspection status filter config ──────────────────────────────────────────

type StatusFilterValue =
  | 'all'
  | 'in_progress'
  | 'awaiting_signatures'
  | 'awaiting_approval'
  | 'completed'
  | 'rejected';

const INSPECTION_STATUSES: ReadonlyArray<StatusFilterValue> = [
  'all',
  'in_progress',
  'awaiting_signatures',
  'awaiting_approval',
  'completed',
  'rejected',
];

type FilterKey = 'status' | 'template' | 'conductedBy' | 'conductedOn';
const ALL_FILTER_KEYS: ReadonlyArray<FilterKey> = [
  'status',
  'template',
  'conductedBy',
  'conductedOn',
];

// ─── Root page ────────────────────────────────────────────────────────────────

export default function InspectionsListPage() {
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';

  return (
    <div className="px-4 py-4 sm:py-6">
      <SectionTabBar activeTab="inspections" locale={locale} />
      <InspectionsTab locale={locale} />
    </div>
  );
}

// ─── Inspections tab ──────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-green-500',
  'bg-orange-500',
  'bg-pink-500',
  'bg-teal-500',
  'bg-red-500',
  'bg-indigo-500',
];

function getAvatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length] ?? 'bg-blue-500';
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase();
}

function formatDisplayDate(d: Date | null | undefined, locale: string): string {
  if (d == null) return '—';
  return new Intl.DateTimeFormat(locale.replace('_', '-'), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(d));
}

function toDateGroupKey(d: Date): string {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth()).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function InspectionsTab({ locale }: { locale: string }) {
  const t = useTranslations('inspections');
  const tFilter = useTranslations('inspections.filter');
  const tCommon = useTranslations('common');
  const tExport = useTranslations('inspections.export');
  const tBulk = useTranslations('inspections.bulk');
  const router = useRouter();
  const utils = trpc.useUtils();

  const [showPicker, setShowPicker] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');
  const [templateFilter, setTemplateFilter] = useState('');
  const [conductedByFilter, setConductedByFilter] = useState('');
  const [conductedFrom, setConductedFrom] = useState('');
  const [conductedTo, setConductedTo] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set());
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  const { data: templateOptions } = trpc.templates.list.useQuery({ includeArchived: false });
  const { data: usersData } = trpc.users.list.useQuery({});

  const { siteId: siteFilter, clear: clearSiteFilter } = useSiteFilterParam();

  const listInput = {
    ...(siteFilter !== '' ? { siteId: siteFilter } : {}),
    ...(activeFilters.has('status') && statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(activeFilters.has('template') && templateFilter !== ''
      ? { templateId: templateFilter }
      : {}),
    ...(activeFilters.has('conductedBy') && conductedByFilter !== ''
      ? { conductedById: conductedByFilter }
      : {}),
    ...(activeFilters.has('conductedOn') && conductedFrom !== ''
      ? { conductedFrom: new Date(`${conductedFrom}T00:00:00`).toISOString() }
      : {}),
    ...(activeFilters.has('conductedOn') && conductedTo !== ''
      ? { conductedTo: new Date(`${conductedTo}T23:59:59`).toISOString() }
      : {}),
    includeArchived,
  };

  function removeFilter(key: FilterKey) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (key === 'status') setStatusFilter('all');
    if (key === 'template') setTemplateFilter('');
    if (key === 'conductedBy') setConductedByFilter('');
    if (key === 'conductedOn') {
      setConductedFrom('');
      setConductedTo('');
    }
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setFilterMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const { data: rows, isLoading } = trpc.inspections.list.useQuery(listInput);

  const archiveMany = trpc.inspectionsExport.archiveMany.useMutation({
    onSuccess: () => {
      setSelectedIds(new Set());
      setBulkArchiveOpen(false);
      void utils.inspections.list.invalidate();
      toast.success(tBulk('archiveSuccess'));
    },
    onError: () => toast.error(tCommon('error')),
  });

  async function exportCurrentFilter() {
    try {
      const res = await utils.client.inspectionsExport.exportCsv.mutate({ filter: listInput });
      triggerCsvDownload(res.csv, `inspections-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success(tExport('downloadReady', { count: res.rowCount }));
    } catch {
      toast.error(tCommon('error'));
    }
  }

  async function exportSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const res = await utils.client.inspectionsExport.exportCsv.mutate({ ids });
      triggerCsvDownload(
        res.csv,
        `inspections-selected-${new Date().toISOString().slice(0, 10)}.csv`,
      );
      toast.success(tExport('downloadReady', { count: res.rowCount }));
    } catch {
      toast.error(tCommon('error'));
    }
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const visible = filteredRows;
    if (selectedIds.size === visible.length && visible.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visible.map((r) => r.id)));
    }
  }

  const filteredRows = useMemo(() => {
    const all = rows ?? [];
    if (!searchQuery.trim()) return all;
    const q = searchQuery.toLowerCase();
    return all.filter(
      (r) => r.title.toLowerCase().includes(q) || (r.templateName ?? '').toLowerCase().includes(q),
    );
  }, [rows, searchQuery]);

  const groupedRows = useMemo(() => {
    const groups: { dateKey: string; label: string; rows: typeof filteredRows }[] = [];
    const seen = new Map<string, number>();
    for (const row of filteredRows) {
      const key = toDateGroupKey(row.startedAt);
      const idx = seen.get(key);
      if (idx === undefined) {
        seen.set(key, groups.length);
        groups.push({
          dateKey: key,
          label: formatDisplayDate(row.startedAt, locale),
          rows: [row],
        });
      } else {
        const group = groups[idx];
        if (group !== undefined) group.rows.push(row);
      }
    }
    return groups;
  }, [filteredRows, locale]);

  const allSelected = filteredRows.length > 0 && selectedIds.size === filteredRows.length;
  const selectionCount = selectedIds.size;
  const totalCount = rows?.length ?? 0;

  return (
    <div className="space-y-4">
      {/* Signatory call-out — invisible unless the caller has pending signatures. */}
      <AwaitingSignatureBanner />

      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          {/* Subtitle is desktop-only — vertical space is precious on phones. */}
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="h-4 w-4"
              aria-label={t('showArchived')}
            />
            <span>{t('showArchived')}</span>
          </label>
          {/* Desktop-only — CSV export is not a phone workflow. */}
          <Button variant="outline" onClick={exportCurrentFilter} className="hidden sm:inline-flex">
            {tExport('button')}
          </Button>
          <Button onClick={() => setShowPicker(true)}>{t('startButton')}</Button>
        </div>
      </header>

      {siteFilter !== '' ? <SiteFilterChip siteId={siteFilter} onClear={clearSiteFilter} /> : null}

      {/* Search + filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="pl-8"
          />
        </div>

        {/* Add filter button + dropdown */}
        <div className="relative" ref={filterMenuRef}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFilterMenuOpen((v) => !v)}
            className="gap-1.5"
          >
            <Filter className="h-3.5 w-3.5" />
            {/* Icon-only on phones. */}
            <span className="hidden sm:inline">{t('addFilter')}</span>
            {activeFilters.size > 0 ? (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {activeFilters.size}
              </span>
            ) : (
              <ChevronDown className="hidden h-3 w-3 text-muted-foreground sm:block" />
            )}
          </Button>
          {filterMenuOpen && ALL_FILTER_KEYS.some((k) => !activeFilters.has(k)) ? (
            <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-md border bg-popover py-1 shadow-lg">
              {ALL_FILTER_KEYS.filter((k) => !activeFilters.has(k)).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setActiveFilters((prev) => new Set(prev).add(k));
                    setFilterMenuOpen(false);
                  }}
                  className="flex w-full items-center px-3 py-2 text-sm hover:bg-accent"
                >
                  {t(`filter_${k}`)}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Status filter chip */}
        {activeFilters.has('status') ? (
          <FilterChip label={t('filter_status')} onRemove={() => removeFilter('status')}>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilterValue)}
              className="border-0 bg-transparent text-xs outline-none"
            >
              {INSPECTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s === 'all'
                    ? t('filterStatusAll')
                    : tFilter(
                        s === 'in_progress'
                          ? 'inProgress'
                          : s === 'awaiting_signatures'
                            ? 'awaitingSignatures'
                            : s === 'awaiting_approval'
                              ? 'awaitingApproval'
                              : s === 'completed'
                                ? 'completed'
                                : 'rejected',
                      )}
                </option>
              ))}
            </select>
          </FilterChip>
        ) : null}

        {/* Template filter chip */}
        {activeFilters.has('template') ? (
          <FilterChip label={t('filter_template')} onRemove={() => removeFilter('template')}>
            <select
              value={templateFilter}
              onChange={(e) => setTemplateFilter(e.target.value)}
              className="max-w-[160px] border-0 bg-transparent text-xs outline-none"
            >
              <option value="">{t('filterAny')}</option>
              {(templateOptions ?? []).map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          </FilterChip>
        ) : null}

        {/* Conducted by filter chip */}
        {activeFilters.has('conductedBy') ? (
          <FilterChip label={t('filter_conductedBy')} onRemove={() => removeFilter('conductedBy')}>
            <select
              value={conductedByFilter}
              onChange={(e) => setConductedByFilter(e.target.value)}
              className="max-w-[160px] border-0 bg-transparent text-xs outline-none"
            >
              <option value="">{t('filterAny')}</option>
              {(usersData?.users ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </FilterChip>
        ) : null}

        {/* Conducted on (date range) filter chip */}
        {activeFilters.has('conductedOn') ? (
          <FilterChip label={t('filter_conductedOn')} onRemove={() => removeFilter('conductedOn')}>
            <span className="flex items-center gap-1">
              <input
                type="date"
                value={conductedFrom}
                onChange={(e) => setConductedFrom(e.target.value)}
                className="border-0 bg-transparent text-xs outline-none"
                aria-label={t('filterFrom')}
              />
              <span className="text-muted-foreground">–</span>
              <input
                type="date"
                value={conductedTo}
                onChange={(e) => setConductedTo(e.target.value)}
                className="border-0 bg-transparent text-xs outline-none"
                aria-label={t('filterTo')}
              />
            </span>
          </FilterChip>
        ) : null}

        <span className="ml-auto text-sm text-muted-foreground">
          {t('resultsCount', { count: filteredRows.length })}
          {filteredRows.length !== totalCount ? ` / ${totalCount}` : ''}
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label={tBulk('selectAll')}
                      className="h-4 w-4"
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">{t('table.inspection')}</th>
                  <th className="w-36 px-3 py-2 font-medium">{t('table.conductedBy')}</th>
                  <th className="w-28 px-3 py-2 font-medium">{t('table.actions')}</th>
                  <th className="w-36 px-3 py-2 font-medium">{t('table.conducted')}</th>
                  <th className="w-36 px-3 py-2 font-medium">{t('table.completed')}</th>
                  <th className="w-32 px-3 py-2" />
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={8} className="px-3 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ))
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      {t('empty')}
                    </td>
                  </tr>
                ) : (
                  groupedRows.map((group) => (
                    <Fragment key={group.dateKey}>
                      <tr className="bg-muted/20">
                        <td
                          colSpan={7}
                          className="px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                        >
                          {group.label}
                        </td>
                      </tr>
                      {group.rows.map((r) => {
                        const isTerminal = r.status === 'completed' || r.status === 'rejected';
                        const conductUrl = `/${locale}/inspections/${r.id}`;
                        // Completed inspections go to the report page (shows inline
                        // preview + download buttons); all other statuses go to the
                        // status page (shows signing / approval / continue flow).
                        const reportUrl =
                          r.status === 'completed'
                            ? `/${locale}/inspections/${r.id}/report`
                            : `/${locale}/inspections/${r.id}/status`;
                        const openCount = r.openActionsCount ?? 0;
                        return (
                          <tr key={r.id} className="border-b last:border-0 hover:bg-muted/10">
                            <td className="px-3 py-3">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(r.id)}
                                onChange={() => toggleRow(r.id)}
                                aria-label={tBulk('selectRow')}
                                className="h-4 w-4"
                              />
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div
                                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${getAvatarColor(r.templateId)}`}
                                >
                                  {getInitials(r.templateName)}
                                </div>
                                <div className="min-w-0">
                                  <Link
                                    href={conductUrl}
                                    className="block truncate font-medium hover:underline"
                                  >
                                    {r.title}
                                    {r.archivedAt !== null ? (
                                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                        {t('archivedBadge')}
                                      </span>
                                    ) : null}
                                  </Link>
                                  {r.templateName !== null ? (
                                    <span className="block truncate text-xs text-muted-foreground">
                                      {r.templateName}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {r.conductedByName ?? '—'}
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {openCount > 0 ? (
                                <span className="text-foreground">
                                  {t('openActionsCount', { count: openCount })}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {formatDisplayDate(r.startedAt, locale)}
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {formatDisplayDate(r.completedAt, locale)}
                            </td>
                            <td className="px-3 py-3 text-right">
                              {isTerminal ? (
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="h-auto p-0 text-primary"
                                  onClick={() => router.push(reportUrl)}
                                >
                                  {t('viewReportButton')}
                                </Button>
                              ) : (
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="h-auto p-0 text-primary"
                                  onClick={() => router.push(conductUrl)}
                                >
                                  {t('continueButton')}
                                </Button>
                              )}
                            </td>
                            <td className="px-3 py-3">
                              <InspectionRowMenu
                                conductUrl={conductUrl}
                                reportUrl={reportUrl}
                                onArchive={() => setArchiveTarget(r.id)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Bulk action bar */}
      {selectionCount > 0 ? (
        <div
          role="region"
          aria-label={tBulk('toolbarLabel')}
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-foreground px-5 py-3 text-background shadow-lg"
        >
          <span className="text-sm font-medium">
            {tBulk('selected', { count: selectionCount })}
          </span>
          <button
            type="button"
            className="text-sm text-background/70 underline underline-offset-2 hover:text-background"
            onClick={toggleAll}
          >
            {tBulk('selectAll')}
          </button>
          <div className="mx-1 h-4 w-px bg-background/30" />
          <Button
            size="sm"
            variant="outline"
            className="rounded-full border-background/30 bg-transparent text-background hover:bg-background/10"
            onClick={exportSelected}
          >
            {tBulk('exportSelected')}
          </Button>
          <Button
            size="sm"
            className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => setBulkArchiveOpen(true)}
          >
            <Archive className="mr-1.5 h-3.5 w-3.5" />
            {tBulk('archiveSelected')}
          </Button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="ml-1 text-background/70 hover:text-background"
            aria-label={tCommon('close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <TemplatePickerDialog open={showPicker} onOpenChange={setShowPicker} locale={locale} />

      {/* Single row archive */}
      <ArchiveDialog
        entity="inspection"
        id={archiveTarget ?? ''}
        open={archiveTarget !== null}
        onOpenChange={(v) => {
          if (!v) setArchiveTarget(null);
        }}
        onConfirm={() => {
          if (archiveTarget !== null) {
            archiveMany.mutate({ ids: [archiveTarget] });
            setArchiveTarget(null);
          }
        }}
        pending={archiveMany.isPending}
      />

      {/* Bulk archive */}
      <Dialog open={bulkArchiveOpen} onOpenChange={setBulkArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tBulk('archiveDialogTitle')}</DialogTitle>
            <DialogDescription>
              {tBulk('archiveDialogDescription', { count: selectionCount })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setBulkArchiveOpen(false)}
              disabled={archiveMany.isPending}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => archiveMany.mutate({ ids: Array.from(selectedIds) })}
              disabled={archiveMany.isPending || selectionCount === 0}
            >
              {tCommon('archive')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── FilterChip ────────────────────────────────────────────────────────────────

function FilterChip({
  label,
  onRemove,
  children,
}: {
  label: string;
  onRemove: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-input bg-background px-2.5 py-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}:</span>
      {children}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`Remove ${label} filter`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function InspectionRowMenu({
  conductUrl,
  reportUrl,
  onArchive,
}: {
  conductUrl: string;
  reportUrl: string;
  onArchive: () => void;
}) {
  const t = useTranslations('inspections');
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          aria-label={t('rowMenu.editInspection')}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => router.push(conductUrl)}>
          <Pencil className="mr-2 h-4 w-4" />
          {t('rowMenu.editInspection')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push(reportUrl)}>
          <FileEdit className="mr-2 h-4 w-4" />
          {t('rowMenu.viewReport')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onSelect={onArchive}>
          <Archive className="mr-2 h-4 w-4" />
          {t('rowMenu.archive')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
