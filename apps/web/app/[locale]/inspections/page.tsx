'use client';

import {
  Archive,
  ArchiveRestore,
  Copy,
  FileEdit,
  MoreHorizontal,
  Pencil,
  QrCode,
  Send,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArchiveDialog } from '../../../src/components/archive-dialog';
import { QrCodeDialog } from '../../../src/components/templates/qr-code-dialog';
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
import { Label } from '../../../src/components/ui/label';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { Textarea } from '../../../src/components/ui/textarea';
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

// ─── Inspection status filter config ──────────────────────────────────────────

const STATUS_FILTERS = [
  { key: 'all', status: undefined as undefined | 'in_progress' },
  { key: 'in_progress', status: 'in_progress' as const },
  { key: 'awaiting_signatures', status: 'awaiting_signatures' as const },
  { key: 'awaiting_approval', status: 'awaiting_approval' as const },
  { key: 'completed', status: 'completed' as const },
  { key: 'rejected', status: 'rejected' as const },
];

// ─── Root page — tab switcher ─────────────────────────────────────────────────

type ActiveTab = 'inspections' | 'templates';

/**
 * Unified Inspections + Templates page.
 *
 * Two tabs at the top mirror SafetyCulture's approach where templates are
 * the authoring surface and inspections are the execution surface — both
 * live under the same nav entry. The Templates sidebar entry is removed;
 * deep links to the template editor (/templates/[id]) are unchanged.
 */
export default function InspectionsListPage() {
  const tNav = useTranslations('nav');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const [activeTab, setActiveTab] = useState<ActiveTab>('inspections');

  return (
    <div className="px-4 py-6">
      {/* Tab bar */}
      <div className="mb-6 flex border-b">
        {(['inspections', 'templates'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tNav(tab)}
          </button>
        ))}
      </div>

      {activeTab === 'inspections' ? (
        <InspectionsTab locale={locale} />
      ) : (
        <TemplatesTab locale={locale} />
      )}
    </div>
  );
}

// ─── Inspections tab ──────────────────────────────────────────────────────────

function InspectionsTab({ locale }: { locale: string }) {
  const t = useTranslations('inspections');
  const tFilter = useTranslations('inspections.filter');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('inspections.status');
  const tExport = useTranslations('inspections.export');
  const tBulk = useTranslations('inspections.bulk');
  const utils = trpc.useUtils();
  const [activeFilter, setActiveFilter] = useState<(typeof STATUS_FILTERS)[number]['key']>('all');
  const [showPicker, setShowPicker] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);

  const filter = STATUS_FILTERS.find((f) => f.key === activeFilter) ?? STATUS_FILTERS[0];
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
    <div className="space-y-6">
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
            <Button size="sm" variant="destructive" onClick={() => setBulkArchiveOpen(true)}>
              {tBulk('archiveSelected')}
            </Button>
          </div>
        </div>
      ) : null}

      <nav className="flex flex-wrap gap-1 overflow-x-auto" aria-label={tCommon('search')}>
        {STATUS_FILTERS.map((f) => {
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
                      <InspectionStatusPill status={r.status} tStatus={tStatus} />
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

      <TemplatePickerDialog open={showPicker} onOpenChange={setShowPicker} locale={locale} />

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

function InspectionStatusPill({
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
          <Button onClick={onSubmit} disabled={selected.length !== 26 || create.isPending}>
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Templates tab ────────────────────────────────────────────────────────────

/**
 * Templates list rendered as a tab inside the Inspections page.
 * All functionality is preserved — row actions, create dialog, archive,
 * export, QR code. The template editor deep links (/templates/[id]) are
 * unchanged and continue to work independently.
 */
function TemplatesTab({ locale }: { locale: string }) {
  const t = useTranslations('templates');
  const utils = trpc.useUtils();

  const [includeArchived, setIncludeArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [qrTarget, setQrTarget] = useState<{ id: string; name: string } | null>(null);

  const { data: rows, isLoading } = trpc.templates.list.useQuery({ includeArchived });

  const archive = trpc.templates.archive.useMutation({
    onSuccess: () => {
      setArchiveTarget(null);
      void utils.templates.list.invalidate();
    },
  });

  return (
    <div className="space-y-6">
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
          <Button
            variant="outline"
            onClick={() => setShowExport(true)}
            aria-label={t('export.button')}
          >
            {t('export.button')}
          </Button>
          <Button onClick={() => setShowCreate(true)} aria-label={t('newButton')}>
            {t('newButton')}
          </Button>
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">{t('table.name')}</th>
                <th className="px-3 py-2 font-medium">{t('table.status')}</th>
                <th className="px-3 py-2 font-medium">{t('table.updated')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="p-4">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ) : (rows ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground">
                    {t('empty')}
                  </td>
                </tr>
              ) : (
                (rows ?? []).map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <Link
                        href={`/${locale}/templates/${r.id}`}
                        className="font-medium hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <TemplateStatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatRelative(r.updatedAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <RowActionsMenu
                        templateId={r.id}
                        status={normaliseTemplateStatus(r.status)}
                        locale={locale}
                        onArchive={() => setArchiveTarget(r.id)}
                        onQrCode={() => setQrTarget({ id: r.id, name: r.name })}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <CreateTemplateDialog open={showCreate} onOpenChange={setShowCreate} locale={locale} />
      <ArchiveDialog
        entity="template"
        id={archiveTarget ?? ''}
        open={archiveTarget !== null}
        onOpenChange={(v) => {
          if (!v) setArchiveTarget(null);
        }}
        onConfirm={() => {
          if (archiveTarget !== null) archive.mutate({ templateId: archiveTarget });
        }}
        pending={archive.isPending}
      />
      <TemplatesExportDialog open={showExport} onOpenChange={setShowExport} />
      {qrTarget !== null ? (
        <QrCodeDialog
          open={qrTarget !== null}
          onOpenChange={(v) => {
            if (!v) setQrTarget(null);
          }}
          templateId={qrTarget.id}
          templateName={qrTarget.name}
        />
      ) : null}
    </div>
  );
}

type NormalisedTemplateStatus = 'draft' | 'published' | 'archived';

function normaliseTemplateStatus(status: string): NormalisedTemplateStatus {
  return status === 'published' || status === 'archived' ? status : 'draft';
}

interface RowActionsMenuProps {
  templateId: string;
  status: NormalisedTemplateStatus;
  locale: string;
  onArchive: () => void;
  onQrCode: () => void;
}

function RowActionsMenu({ templateId, status, locale, onArchive, onQrCode }: RowActionsMenuProps) {
  const t = useTranslations('templates.list');
  const router = useRouter();
  const utils = trpc.useUtils();

  const duplicate = trpc.templates.duplicate.useMutation({
    onSuccess: () => {
      void utils.templates.list.invalidate();
    },
  });
  const unarchive = trpc.templates.unarchive.useMutation({
    onSuccess: () => {
      toast.success(t('restoreSuccess'));
      void utils.templates.list.invalidate();
    },
    onError: () => toast.error(t('restoreError')),
  });
  const unpublish = trpc.templates.unpublish.useMutation({
    onSuccess: () => {
      toast.success(t('unpublishSuccess'));
      void utils.templates.list.invalidate();
    },
    onError: () => toast.error(t('unpublishError')),
  });

  function goToEditor() {
    router.push(`/${locale}/templates/${templateId}`);
  }

  async function copyPublicLink() {
    if (typeof window === 'undefined') return;
    const url = `${window.location.origin}/${locale}/templates/${templateId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('copyLinkSuccess'));
    } catch {
      toast.error(t('copyLinkSuccess'));
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          aria-label={t('actionsMenuLabel')}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {status === 'draft' ? (
          <>
            <DropdownMenuItem onSelect={goToEditor}>
              <Pencil className="mr-2 h-4 w-4" />
              {t('actionEdit')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={goToEditor}>
              <Send className="mr-2 h-4 w-4" />
              {t('actionPublish')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => duplicate.mutate({ templateId })}
              disabled={duplicate.isPending}
            >
              <Copy className="mr-2 h-4 w-4" />
              {t('actionDuplicate')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onQrCode}>
              <QrCode className="mr-2 h-4 w-4" />
              {t('actionQrCode')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={copyPublicLink}>
              <Copy className="mr-2 h-4 w-4" />
              {t('actionCopyLink')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={onArchive}>
              <Archive className="mr-2 h-4 w-4" />
              {t('actionArchive')}
            </DropdownMenuItem>
          </>
        ) : status === 'published' ? (
          <>
            <DropdownMenuItem onSelect={goToEditor}>
              <Pencil className="mr-2 h-4 w-4" />
              {t('actionEdit')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => unpublish.mutate({ templateId })}
              disabled={unpublish.isPending}
            >
              <FileEdit className="mr-2 h-4 w-4" />
              {t('actionUnpublish')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => duplicate.mutate({ templateId })}
              disabled={duplicate.isPending}
            >
              <Copy className="mr-2 h-4 w-4" />
              {t('actionDuplicate')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onQrCode}>
              <QrCode className="mr-2 h-4 w-4" />
              {t('actionQrCode')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={copyPublicLink}>
              <Copy className="mr-2 h-4 w-4" />
              {t('actionCopyLink')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={onArchive}>
              <Archive className="mr-2 h-4 w-4" />
              {t('actionArchive')}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem
              onSelect={() => unarchive.mutate({ templateId })}
              disabled={unarchive.isPending}
            >
              <ArchiveRestore className="mr-2 h-4 w-4" />
              {t('actionRestore')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => duplicate.mutate({ templateId })}
              disabled={duplicate.isPending}
            >
              <Copy className="mr-2 h-4 w-4" />
              {t('actionDuplicate')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onQrCode}>
              <QrCode className="mr-2 h-4 w-4" />
              {t('actionQrCode')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={copyPublicLink}>
              <Copy className="mr-2 h-4 w-4" />
              {t('actionCopyLink')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TemplatesExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useTranslations('templates.export');
  const [running, setRunning] = useState(false);
  const utils = trpc.useUtils();

  async function downloadNow() {
    setRunning(true);
    try {
      const result = await utils.templates.exportAllCsv.fetch();
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `templates-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onOpenChange(false);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={downloadNow} disabled={running}>
            {t('downloadNow')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateStatusBadge({ status }: { status: string }) {
  const t = useTranslations('templates.status');
  const normalised: NormalisedTemplateStatus =
    status === 'published' || status === 'archived' ? status : 'draft';
  const colors: Record<NormalisedTemplateStatus, string> = {
    draft: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
    published: 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100',
    archived: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${colors[normalised]}`}>
      {t(normalised)}
    </span>
  );
}

function CreateTemplateDialog({
  open,
  onOpenChange,
  locale,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locale: string;
}) {
  const t = useTranslations('templates.create');
  const utils = trpc.useUtils();
  const create = trpc.templates.create.useMutation({
    onSuccess: (result) => {
      void utils.templates.list.invalidate();
      onOpenChange(false);
      window.location.href = `/${locale}/templates/${result.templateId}`;
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription />
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            const name = String(data.get('name') ?? '').trim();
            const description = String(data.get('description') ?? '').trim();
            if (name.length === 0) return;
            create.mutate({
              name,
              ...(description.length > 0 ? { description } : {}),
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">{t('nameLabel')}</Label>
            <Input id="tpl-name" name="name" placeholder={t('namePlaceholder')} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-desc">{t('descriptionLabel')}</Label>
            <Textarea id="tpl-desc" name="description" rows={3} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
