'use client';

import {
  Archive,
  ArchiveRestore,
  Building2,
  Copy,
  Download,
  FileEdit,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  QrCode,
  Send,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArchiveDialog } from '../../../src/components/archive-dialog';
import { CreateTemplateDialog } from '../../../src/components/templates/create-template-dialog';
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
import { Skeleton } from '../../../src/components/ui/skeleton';
import { FilterBar, type FilterDef } from '../../../src/components/filter-bar';
import { ModuleHeader } from '../../../src/components/module-header';
import { TooltipIconButton } from '../../../src/components/ui/tooltip-icon-button';
import { SectionTabBar } from '../../../src/components/inspections/section-tab-bar';
import { trpc } from '../../../src/lib/trpc/client';

type NormalisedStatus = 'draft' | 'published' | 'archived';
type StatusFilterValue = 'all' | NormalisedStatus;
type AccessFilterValue = 'all' | 'allUsers' | 'restricted';

export default function TemplatesListPage() {
  const t = useTranslations('templates');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();
  const utils = trpc.useUtils();

  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');
  const [accessFilter, setAccessFilter] = useState<AccessFilterValue>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [qrTarget, setQrTarget] = useState<{ id: string; name: string } | null>(null);
  const [startingFor, setStartingFor] = useState<string | null>(null);

  const { data: rows, isLoading } = trpc.templates.list.useQuery({ includeArchived: true });

  const startInspection = trpc.inspections.create.useMutation({
    onSuccess: (res) => {
      setStartingFor(null);
      router.push(`/${locale}/inspections/${res.inspectionId}`);
    },
    onError: () => {
      setStartingFor(null);
      toast.error(t('list.startInspectionError'));
    },
  });

  const archive = trpc.templates.archive.useMutation({
    onSuccess: () => {
      setArchiveTarget(null);
      void utils.templates.list.invalidate();
    },
  });

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => {
      const status = normaliseStatus(r.status);

      // Default: hide archived unless explicitly requested via status filter
      if (!activeFilters.has('status') && status === 'archived') return false;

      // Status filter
      if (activeFilters.has('status') && statusFilter !== 'all' && status !== statusFilter)
        return false;

      // Access filter
      if (activeFilters.has('access') && accessFilter !== 'all') {
        const hasRule = r.accessRuleId !== null;
        if (accessFilter === 'allUsers' && hasRule) return false;
        if (accessFilter === 'restricted' && !hasRule) return false;
      }

      // Text search
      if (search.trim().length > 0) {
        const q = search.toLowerCase();
        const inName = r.name.toLowerCase().includes(q);
        const inDesc = r.description?.toLowerCase().includes(q) ?? false;
        if (!inName && !inDesc) return false;
      }

      return true;
    });
  }, [rows, search, statusFilter, accessFilter, activeFilters]);

  function addFilter(key: string) {
    setActiveFilters((prev) => new Set([...prev, key]));
  }

  function removeFilter(key: string) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (key === 'status') setStatusFilter('all');
    if (key === 'access') setAccessFilter('all');
  }

  const hasActiveFilters = activeFilters.size > 0 || search.trim().length > 0;
  const totalCount = rows?.filter((r) => normaliseStatus(r.status) !== 'archived').length ?? 0;

  const filterDefs: FilterDef[] = [
    {
      key: 'status',
      label: t('filter.status'),
      control: {
        kind: 'select',
        value: statusFilter,
        onValueChange: (v) => setStatusFilter(v as StatusFilterValue),
        options: [
          { value: 'all', label: t('filter.any') },
          { value: 'draft', label: t('status.draft') },
          { value: 'published', label: t('status.published') },
          { value: 'archived', label: t('status.archived') },
        ],
      },
    },
    {
      key: 'access',
      label: t('filter.access'),
      control: {
        kind: 'select',
        value: accessFilter,
        onValueChange: (v) => setAccessFilter(v as AccessFilterValue),
        options: [
          { value: 'all', label: t('filter.any') },
          { value: 'allUsers', label: t('filter.allUsers') },
          { value: 'restricted', label: t('filter.restricted') },
        ],
      },
    },
  ];
  const activeFilterKeys = filterDefs.map((f) => f.key).filter((k) => activeFilters.has(k));

  return (
    <div>
      <SectionTabBar activeTab="templates" locale={locale} />
      <div className="space-y-4">
        <ModuleHeader title={t('title')}>
          <TooltipIconButton
            icon={Download}
            label={t('export.button')}
            onClick={() => setShowExport(true)}
          />
          <Button onClick={() => setShowCreate(true)}>{t('newButton')}</Button>
        </ModuleHeader>

        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: t('searchPlaceholder') }}
          filters={filterDefs}
          activeKeys={activeFilterKeys}
          onAddFilter={addFilter}
          onRemoveFilter={removeFilter}
          resultsCount={filtered.length}
          resultsSuffix={rows !== undefined ? ` / ${totalCount}` : undefined}
        />

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr className="text-left">
                    {/* Bulk-select is desktop-only; on phones the column just
                     * eats width the template names need. */}
                    <th className="hidden w-10 px-4 py-3 sm:table-cell">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input accent-primary"
                        aria-label={t('table.selectAll')}
                      />
                    </th>
                    <th className="px-3 py-3 font-medium">{t('table.name')}</th>
                    <th className="hidden px-3 py-3 font-medium md:table-cell">
                      {t('table.lastPublished')}
                    </th>
                    <th className="hidden px-3 py-3 font-medium lg:table-cell">
                      {t('table.access')}
                    </th>
                    <th className="px-3 py-3 font-medium">{t('table.status')}</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td colSpan={6} className="px-4 py-4">
                          <Skeleton className="h-8 w-full" />
                        </td>
                      </tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        {hasActiveFilters ? t('emptySearch') : t('empty')}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((r) => {
                      const status = normaliseStatus(r.status);
                      const isPublished = status === 'published' && r.archivedAt === null;
                      const isStarting = startingFor === r.id && startInspection.isPending;
                      return (
                        <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="hidden px-4 py-3 sm:table-cell">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-input accent-primary"
                              aria-label={t('table.selectRow')}
                            />
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300">
                                <LayoutGrid className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <Link
                                  href={`/${locale}/templates/${r.id}`}
                                  className="font-medium hover:underline"
                                >
                                  {r.name}
                                </Link>
                                {r.description !== null && r.description.length > 0 ? (
                                  <p className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground">
                                    {r.description}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="hidden px-3 py-3 text-muted-foreground md:table-cell">
                            {r.lastPublishedAt !== null ? formatRelative(r.lastPublishedAt) : '—'}
                          </td>
                          <td className="hidden px-3 py-3 lg:table-cell">
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                              {r.accessRuleId === null ? (
                                <>
                                  <Users className="h-3.5 w-3.5 shrink-0" />
                                  <span className="text-xs">{t('allUsers')}</span>
                                </>
                              ) : (
                                <>
                                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                                  <span className="text-xs">
                                    {r.accessRuleName ?? t('restricted')}
                                  </span>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <StatusBadge status={r.status} />
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-end gap-2">
                              {isPublished ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="hidden sm:flex"
                                  disabled={isStarting}
                                  onClick={() => {
                                    setStartingFor(r.id);
                                    startInspection.mutate({ templateId: r.id });
                                  }}
                                >
                                  {isStarting
                                    ? t('list.startingInspection')
                                    : t('list.startInspection')}
                                </Button>
                              ) : null}
                              <RowActionsMenu
                                templateId={r.id}
                                status={status}
                                locale={locale}
                                onArchive={() => setArchiveTarget(r.id)}
                                onQrCode={() => setQrTarget({ id: r.id, name: r.name })}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
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
    </div>
  );
}

// ─── Row actions menu ──────────────────────────────────────────────────────────

function normaliseStatus(status: string): NormalisedStatus {
  return status === 'published' || status === 'archived' ? status : 'draft';
}

interface RowActionsMenuProps {
  templateId: string;
  status: NormalisedStatus;
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

// ─── Export dialog ─────────────────────────────────────────────────────────────

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

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('templates.status');
  const normalised: 'draft' | 'published' | 'archived' =
    status === 'published' || status === 'archived' ? status : 'draft';
  const colors: Record<typeof normalised, string> = {
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

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(d: Date): string {
  const ms = Date.now() - new Date(d).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
