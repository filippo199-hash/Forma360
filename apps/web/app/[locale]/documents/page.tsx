'use client';

import { ChevronRight, File, FolderOpen, FolderPlus, Plus, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FolderTree } from '../../../src/components/documents/folder-tree';
import { SiteFilterChip, useSiteFilterParam } from '../../../src/components/site-filter-chip';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../src/components/ui/dialog';
import { Input } from '../../../src/components/ui/input';
import { Label } from '../../../src/components/ui/label';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';

type FolderCrumb = {
  id: string;
  name: string;
  visibleToGroupIds?: string[];
  visibleToSiteIds?: string[];
};

export default function DocumentsPage() {
  const t = useTranslations('documents.list');
  const tFolder = useTranslations('documents.folder');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canFolderManage = useHasPermission('documents.folders.manage');
  const utils = trpc.useUtils();
  const { siteId: siteFilter, clear: clearSiteFilter } = useSiteFilterParam();

  // Breadcrumb-based folder navigation
  const [folderPath, setFolderPath] = useState<FolderCrumb[]>([]);
  const currentFolder = folderPath.at(-1) ?? null;
  const currentFolderId = currentFolder?.id ?? null;

  const [query, setQuery] = useState('');

  // New-folder dialog state
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderGroupIds, setNewFolderGroupIds] = useState<string[]>([]);
  const [newFolderSiteIds, setNewFolderSiteIds] = useState<string[]>([]);

  // Every folder (flat, with parentId) — the sidebar builds a nested tree.
  const { data: allFolders = [], isLoading: foldersLoading } = trpc.documentFolders.list.useQuery(
    {},
  );

  // Documents — undefined folderId = all docs; string = scoped to folder.
  // When a site/project filter is active, list that site's docs across all
  // folders (folderId untethered) so the hub drill-in shows everything.
  const { data: docs = [], isLoading: docsLoading } = trpc.documents.list.useQuery({
    folderId: siteFilter !== '' ? undefined : (currentFolderId ?? undefined),
    query: query.trim().length > 0 ? query.trim() : undefined,
    ...(siteFilter !== '' ? { siteId: siteFilter } : {}),
  });

  // Labels for color-pill resolution
  const { data: allLabels = [] } = trpc.documentLabels.list.useQuery();
  const labelMap = new Map(allLabels.map((l) => [l.id, l]));

  // Edit the CURRENT folder's visibility (To-Do #6).
  const [folderAccessOpen, setFolderAccessOpen] = useState(false);
  const [editFolderName, setEditFolderName] = useState('');
  const [editFolderGroupIds, setEditFolderGroupIds] = useState<string[]>([]);
  const [editFolderSiteIds, setEditFolderSiteIds] = useState<string[]>([]);

  // Groups + sites loaded lazily for the folder create / access dialogs
  const { data: groups = [] } = trpc.groups.list.useQuery(undefined, {
    enabled: showFolderDialog || folderAccessOpen,
  });
  const { data: sites = [] } = trpc.sites.list.useQuery(undefined, {
    enabled: showFolderDialog || folderAccessOpen,
  });

  const createFolder = trpc.documentFolders.create.useMutation({
    onSuccess: () => {
      toast.success(t('folderCreatedToast'));
      setNewFolderName('');
      setNewFolderGroupIds([]);
      setNewFolderSiteIds([]);
      setShowFolderDialog(false);
      void utils.documentFolders.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const updateFolder = trpc.documentFolders.update.useMutation({
    onSuccess: () => {
      toast.success(t('folderAccessSavedToast'));
      setFolderAccessOpen(false);
      void utils.documentFolders.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function openFolderAccess() {
    setEditFolderName(currentFolder?.name ?? '');
    setEditFolderGroupIds(currentFolder?.visibleToGroupIds ?? []);
    setEditFolderSiteIds(currentFolder?.visibleToSiteIds ?? []);
    setFolderAccessOpen(true);
  }
  function toggleEditGroupId(id: string) {
    setEditFolderGroupIds((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    );
  }
  function toggleEditSiteId(id: string) {
    setEditFolderSiteIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }

  function navigateToCrumb(index: number) {
    // index -1 → root
    setFolderPath(index < 0 ? [] : folderPath.slice(0, index + 1));
  }

  function toggleGroupId(id: string) {
    setNewFolderGroupIds((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    );
  }

  function toggleSiteId(id: string) {
    setNewFolderSiteIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {canFolderManage && currentFolderId !== null ? (
            <Button type="button" variant="outline" onClick={openFolderAccess}>
              {t('folderSettingsButton')}
            </Button>
          ) : null}
          {canFolderManage ? (
            <Button type="button" variant="outline" onClick={() => setShowFolderDialog(true)}>
              <FolderPlus className="mr-1 h-4 w-4" />
              {t('newFolderButton')}
            </Button>
          ) : null}
          <Button type="button" asChild>
            <Link href={`/${locale}/documents/new`}>
              <Upload className="mr-1 h-4 w-4" />
              {t('uploadButton')}
            </Link>
          </Button>
        </div>
      </header>

      {siteFilter !== '' ? <SiteFilterChip siteId={siteFilter} onClear={clearSiteFilter} /> : null}

      {/* New Folder dialog */}
      <Dialog open={showFolderDialog} onOpenChange={setShowFolderDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tFolder('createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="folder-name">{tFolder('nameLabel')}</Label>
              <Input
                id="folder-name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={tFolder('nameLabel')}
                maxLength={500}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newFolderName.trim().length > 0) {
                    createFolder.mutate({
                      name: newFolderName.trim(),
                      parentId: currentFolderId ?? undefined,
                      visibleToGroupIds: newFolderGroupIds,
                      visibleToSiteIds: newFolderSiteIds,
                    });
                  }
                  if (e.key === 'Escape') setShowFolderDialog(false);
                }}
              />
            </div>

            {groups.length > 0 ? (
              <div className="space-y-1.5">
                <Label>{tFolder('groupsLabel')}</Label>
                <p className="text-xs text-muted-foreground">{tFolder('visibilityHint')}</p>
                <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                  {groups.map((g) => (
                    <label key={g.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={newFolderGroupIds.includes(g.id)}
                        onChange={() => toggleGroupId(g.id)}
                        className="h-4 w-4 rounded border"
                      />
                      {g.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {sites.length > 0 ? (
              <div className="space-y-1.5">
                <Label>{tFolder('sitesLabel')}</Label>
                <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                  {sites.map((s) => (
                    <label key={s.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={newFolderSiteIds.includes(s.id)}
                        onChange={() => toggleSiteId(s.id)}
                        className="h-4 w-4 rounded border"
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setShowFolderDialog(false)}>
                {tCommon('cancel')}
              </Button>
              <Button
                type="button"
                disabled={createFolder.isPending || newFolderName.trim().length === 0}
                onClick={() =>
                  createFolder.mutate({
                    name: newFolderName.trim(),
                    parentId: currentFolderId ?? undefined,
                    visibleToGroupIds: newFolderGroupIds,
                    visibleToSiteIds: newFolderSiteIds,
                  })
                }
              >
                {tFolder('saveButton')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Folder access (current folder visibility) dialog — To-Do #6 */}
      <Dialog open={folderAccessOpen} onOpenChange={setFolderAccessOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('folderSettingsTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="folder-name">{t('folderNameLabel')}</Label>
              <Input
                id="folder-name"
                value={editFolderName}
                onChange={(e) => setEditFolderName(e.target.value)}
                maxLength={120}
              />
            </div>
            <p className="text-xs text-muted-foreground">{tFolder('visibilityHint')}</p>
            {groups.length > 0 ? (
              <div className="space-y-1.5">
                <Label>{tFolder('groupsLabel')}</Label>
                <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                  {groups.map((g) => (
                    <label key={g.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editFolderGroupIds.includes(g.id)}
                        onChange={() => toggleEditGroupId(g.id)}
                        className="h-4 w-4 rounded border"
                      />
                      {g.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            {sites.length > 0 ? (
              <div className="space-y-1.5">
                <Label>{tFolder('sitesLabel')}</Label>
                <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                  {sites.map((s) => (
                    <label key={s.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editFolderSiteIds.includes(s.id)}
                        onChange={() => toggleEditSiteId(s.id)}
                        className="h-4 w-4 rounded border"
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setFolderAccessOpen(false)}>
                {tCommon('cancel')}
              </Button>
              <Button
                type="button"
                disabled={
                  updateFolder.isPending ||
                  currentFolderId === null ||
                  editFolderName.trim().length === 0
                }
                onClick={() => {
                  if (currentFolderId === null) return;
                  const name = editFolderName.trim();
                  updateFolder.mutate({
                    folderId: currentFolderId,
                    name,
                    visibleToGroupIds: editFolderGroupIds,
                    visibleToSiteIds: editFolderSiteIds,
                  });
                  // Reflect the rename in the local breadcrumb immediately.
                  setFolderPath((prev) =>
                    prev.map((c) => (c.id === currentFolderId ? { ...c, name } : c)),
                  );
                }}
              >
                {tFolder('saveButton')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Two-panel layout */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        {/* Folder sidebar — sticky + scrollable for large trees */}
        <aside className="min-w-0 space-y-1 overflow-x-auto md:sticky md:top-4 md:max-h-[calc(100vh-7rem)] md:self-start md:overflow-y-auto md:pr-1">
          {foldersLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <FolderTree
              folders={allFolders}
              currentFolderId={currentFolderId}
              allDocumentsLabel={t('allDocuments')}
              onNavigate={setFolderPath}
            />
          )}
        </aside>

        {/* Main area */}
        <div className="space-y-4">
          {/* Breadcrumb */}
          {folderPath.length > 0 ? (
            <nav className="flex items-center gap-1 text-sm text-muted-foreground">
              <button
                type="button"
                onClick={() => navigateToCrumb(-1)}
                className="hover:text-foreground hover:underline"
              >
                {t('allDocuments')}
              </button>
              {folderPath.map((crumb, idx) => (
                <span key={crumb.id} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3" />
                  <button
                    type="button"
                    onClick={() => navigateToCrumb(idx)}
                    className={
                      idx === folderPath.length - 1
                        ? 'font-medium text-foreground'
                        : 'hover:text-foreground hover:underline'
                    }
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </nav>
          ) : null}

          {/* Search */}
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
          />

          {/* Documents */}
          {docsLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : docs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FolderOpen className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                <p className="mb-4 text-sm text-muted-foreground">
                  {currentFolderId !== null ? t('emptyFolder') : t('empty')}
                </p>
                <Button type="button" size="sm" asChild>
                  <Link href={`/${locale}/documents/new`}>
                    <Plus className="mr-1 h-4 w-4" />
                    {t('uploadButton')}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-medium">{t('columns.name')}</th>
                        <th className="px-3 py-2 font-medium">{t('columns.version')}</th>
                        <th className="px-3 py-2 font-medium">{t('columns.size')}</th>
                        <th className="px-3 py-2 font-medium">{t('columns.expiresAt')}</th>
                        <th className="px-3 py-2 font-medium">{t('columns.uploadedBy')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {docs.map((doc) => {
                        const now = Date.now();
                        const isExpired =
                          doc.expiresAt !== null && new Date(doc.expiresAt).getTime() < now;
                        const daysUntilExpiry =
                          doc.expiresAt !== null
                            ? Math.ceil((new Date(doc.expiresAt).getTime() - now) / 86_400_000)
                            : null;
                        const isStale =
                          doc.freshnessDays !== null &&
                          (now - new Date(doc.updatedAt).getTime()) / 86_400_000 >
                            doc.freshnessDays;
                        const docLabelIds = Array.isArray(doc.labelIds)
                          ? (doc.labelIds as string[])
                          : [];
                        const docLabels = docLabelIds
                          .map((id) => labelMap.get(id))
                          .filter((l): l is NonNullable<typeof l> => l !== undefined);

                        return (
                          <tr key={doc.id} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="max-w-xs px-3 py-2.5">
                              <div className="flex flex-col gap-1">
                                <Link
                                  href={`/${locale}/documents/${doc.id}`}
                                  className="inline-flex items-center gap-1.5 font-medium hover:underline"
                                >
                                  <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  <span className="truncate">{doc.name}</span>
                                </Link>
                                <div className="flex flex-wrap gap-1">
                                  {isExpired ? (
                                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200">
                                      {t('expiredTag')}
                                    </span>
                                  ) : daysUntilExpiry !== null && daysUntilExpiry <= 30 ? (
                                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                                      {t('expiresInTag', {
                                        days: String(daysUntilExpiry),
                                      })}
                                    </span>
                                  ) : null}
                                  {isStale ? (
                                    <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800 dark:bg-orange-900/40 dark:text-orange-100">
                                      {t('staleTag')}
                                    </span>
                                  ) : null}
                                  {docLabels.map((lbl) => (
                                    <span
                                      key={lbl.id}
                                      className="rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
                                      style={{ backgroundColor: lbl.color }}
                                    >
                                      {lbl.name}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground">
                              {t('versionNum', { n: String(doc.currentVersion) })}
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground">
                              {formatBytes(doc.sizeBytes)}
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground">
                              {doc.expiresAt !== null
                                ? new Date(doc.expiresAt).toLocaleDateString()
                                : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground">
                              {doc.uploaderName ?? '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
