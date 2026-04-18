'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
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
import { Skeleton } from '../../../src/components/ui/skeleton';
import { trpc } from '../../../src/lib/trpc/client';

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

const FILTERS = [
  { key: 'all', status: undefined as undefined | 'in_progress' },
  { key: 'in_progress', status: 'in_progress' as const },
  { key: 'awaiting_signatures', status: 'awaiting_signatures' as const },
  { key: 'awaiting_approval', status: 'awaiting_approval' as const },
  { key: 'completed', status: 'completed' as const },
  { key: 'rejected', status: 'rejected' as const },
];

export default function InspectionsListPage() {
  const t = useTranslations('inspections');
  const tFilter = useTranslations('inspections.filter');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('inspections.status');
  const tExport = useTranslations('inspections.export');
  const tBulk = useTranslations('inspections.bulk');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const utils = trpc.useUtils();
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const [showPicker, setShowPicker] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);

  const filter = FILTERS.find((f) => f.key === activeFilter) ?? FILTERS[0];
  const listInput = {
    ...(filter?.status !== undefined ? { status: filter.status } : {}),
    includeArchived,
  };
  const { data: rows, isLoading } = trpc.inspections.list.useQuery(listInput);

  const archiveMany = trpc.inspectionsExport.archiveMany.useMutation({
    onSuccess: () => {
      setSelectedIds(new Set());
      setBulkArchiveOpen(false);
      void utils.inspections.list.invalidate();
      toast.success(tBulk('archiveSuccess'));
    },
    onError: () => {
      toast.error(tCommon('error'));
    },
  });

  async function exportCurrentFilter() {
    try {
      const res = await utils.client.inspectionsExport.exportCsv.mutate({ filter: listInput });
      triggerCsvDownload(
        res.csv,
        `inspections-${new Date().toISOString().slice(0, 10)}.csv`,
      );
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
    const visible = rows ?? [];
    if (selectedIds.size === visible.length && visible.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visible.map((r) => r.id)));
    }
  }

  const visibleRows = rows ?? [];
  const allSelected = visibleRows.length > 0 && selectedIds.size === visibleRows.length;
  const selectionCount = selectedIds.size;

  return (
    <div className="space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
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
          <Button variant="outline" onClick={exportCurrentFilter} aria-label={tExport('button')}>
            {tExport('button')}
          </Button>
          <Button onClick={() => setShowPicker(true)}>{t('startButton')}</Button>
        </div>
      </header>

      {selectionCount > 0 ? (
        <div
          role="region"
          aria-label={tBulk('toolbarLabel')}
          className="flex flex-wrap items-center gap-2 rounded-md border bg-accent/40 px-3 py-2 text-sm"
        >
          <span className="font-medium">{tBulk('selected', { count: selectionCount })}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={exportSelected}>
              {tBulk('exportSelected')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setBulkArchiveOpen(true)}
            >
              {tBulk('archiveSelected')}
            </Button>
          </div>
        </div>
      ) : null}

      <nav className="flex flex-wrap gap-1 overflow-x-auto" aria-label={tCommon('search')}>
        {FILTERS.map((f) => {
          const active = f.key === activeFilter;
          const label =
            f.key === 'all'
              ? tCommon('search')
              : f.key === 'in_progress'
                ? tFilter('inProgress')
                : f.key === 'awaiting_signatures'
                  ? tFilter('awaitingSignatures')
                  : f.key === 'awaiting_approval'
                    ? tFilter('awaitingApproval')
                    : f.key === 'completed'
                      ? tFilter('completed')
                      : tFilter('rejected');
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setActiveFilter(f.key)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
              }`}
            >
              {label}
            </button>
          );
        })}
      </nav>

      <Card>
        <CardContent className="p-0">
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
                <th className="px-3 py-2 font-medium">{t('table.title')}</th>
                <th className="px-3 py-2 font-medium">{t('table.documentNumber')}</th>
                <th className="px-3 py-2 font-medium">{t('table.status')}</th>
                <th className="px-3 py-2 font-medium">{t('table.startedAt')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-4">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    {t('empty')}
                  </td>
                </tr>
              ) : (
                visibleRows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleRow(r.id)}
                        aria-label={tBulk('selectRow')}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/${locale}/inspections/${r.id}`}
                        className="font-medium hover:underline"
                      >
                        {r.title}
                      </Link>
                      {r.archivedAt !== null ? (
                        <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {t('archivedBadge')}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {r.documentNumber ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill status={r.status} tStatus={tStatus} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatRelative(r.startedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <TemplatePickerDialog
        open={showPicker}
        onOpenChange={setShowPicker}
        locale={locale}
      />

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

function StatusPill({
  status,
  tStatus,
}: {
  status: string;
  tStatus: ReturnType<typeof useTranslations<'inspections.status'>>;
}) {
  const key = [
    'in_progress',
    'awaiting_signatures',
    'awaiting_approval',
    'completed',
    'rejected',
  ].includes(status)
    ? (status as 'in_progress')
    : 'in_progress';
  const colors: Record<string, string> = {
    in_progress: 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100',
    awaiting_signatures: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
    awaiting_approval: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
    completed: 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100',
    rejected: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100',
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${colors[key]}`}>
      {tStatus(key)}
    </span>
  );
}

function formatRelative(d: Date): string {
  const ms = Date.now() - new Date(d).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function TemplatePickerDialog({
  open,
  onOpenChange,
  locale,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locale: string;
}) {
  const t = useTranslations('inspections.picker');
  const router = useRouter();
  const { data: templates, isLoading } = trpc.templates.list.useQuery(
    { status: 'published' },
    { enabled: open },
  );
  const [selected, setSelected] = useState<string>('');

  const published = useMemo(
    () => (templates ?? []).filter((r) => r.currentVersionId !== null && r.archivedAt === null),
    [templates],
  );

  const create = trpc.inspections.create.useMutation({
    onSuccess: (res) => {
      onOpenChange(false);
      router.push(`/${locale}/inspections/${res.inspectionId}`);
    },
    onError: () => toast.error(t('loadError')),
  });

  function onSubmit() {
    if (selected.length !== 26) return;
    create.mutate({ templateId: selected });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[40vh] overflow-y-auto">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : published.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="space-y-1">
              {published.map((tpl) => {
                const checked = selected === tpl.id;
                return (
                  <li key={tpl.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm">
                      <input
                        type="radio"
                        name="template"
                        checked={checked}
                        onChange={() => setSelected(tpl.id)}
                        className="h-4 w-4"
                      />
                      <span className="flex-1">
                        <span className="font-medium">{tpl.name}</span>
                        {tpl.description !== null ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {tpl.description}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={onSubmit}
            disabled={selected.length !== 26 || create.isPending}
          >
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
