'use client';

import {
  ChevronRight,
  File,
  FolderOpen,
  FolderPlus,
  Plus,
  Upload,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
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

type FolderCrumb = { id: string; name: string };

export default function DocumentsPage() {
  const t = useTranslations('documents.list');
  const tFolder = useTranslations('documents.folder');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canFolderManage = useHasPermission('documents.folders.manage');
  const utils = trpc.useUtils();

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

  // Top-level folders for the sidebar
  const { data: rootFolders = [], isLoading: rootLoading } =
    trpc.documentFolders.list.useQuery({ parentId: null });

  // Sub-folders of the current selected folder
  const { data: subFolders = [], isLoading: subLoading } =
    trpc.documentFolders.list.useQuery(
      { parentId: currentFolderId },
      { enabled: currentFolderId !== null },
    );

  // Documents — undefined folderId = all docs; string = scoped to folder
  const { data: docs = [], isLoading: docsLoading } = trpc.documents.list.useQuery({
    folderId: currentFolderId ?? undefined,
    query: query.trim().length > 0 ? query.trim() : undefined,
  });

  // Labels for color-pill resolution
  const { data: allLabels = [] } = trpc.documentLabels.list.useQuery();
  const labelMap = new Map(allLabels.map((l) => [l.id, l]));

  // Groups + sites loaded lazily for the folder dialog
  const { data: groups = [] } = trpc.groups.list.useQuery(undefined, {
    enabled: showFolderDialog,
  });
  const { data: sites = [] } = trpc.sites.list.useQuery(undefined, {
    enabled: showFolderDialog,
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
    onError: (err) =>
      toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function openFolderInSidebar(folder: FolderCrumb) {
    setFolderPath([folder]);
  }

  function navigateIntoSubfolder(folder: FolderCrumb) {
    setFolderPath((prev) => [...prev, folder]);
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
          {canFolderManage ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowFolderDialog(true)}
            >
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
                    <label
                      key={g.id}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
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
                    <label
                      key={s.id}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
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
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowFolderDialog(false)}
              >
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

      {/* Two-panel layout */}
      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        {/* Folder sidebar */}
        <aside className="space-y-1">
          <button
            type="button"
            onClick={() => navigateToCrumb(-1)}
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
              folderPath.length === 0
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            }`}
          >
            <FolderOpen className="h-4 w-4 shrink-0" />
            {t('allDocuments')}
          </button>

          {rootLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            rootFolders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => openFolderInSidebar({ id: folder.id, name: folder.name })}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  folderPath[0]?.id === folder.id
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="truncate">{folder.name}</span>
              </button>
            ))
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

          {/* Sub-folders inside current folder */}
          {currentFolderId !== null ? (
            subLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : subFolders.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {subFolders.map((sf) => (
                  <button
                    key={sf.id}
                    type="button"
                    onClick={() => navigateIntoSubfolder({ id: sf.id, name: sf.name })}
                    className="flex items-center gap-2 rounded-md border bg-card px-3 py-2.5 text-sm transition-colors hover:bg-accent text-left"
                  >
                    <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{sf.name}</span>
                  </button>
                ))}
              </div>
            ) : null
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
                          doc.expiresAt !== null &&
                          new Date(doc.expiresAt).getTime() < now;
                        const daysUntilExpiry =
                          doc.expiresAt !== null
                            ? Math.ceil(
                                (new Date(doc.expiresAt).getTime() - now) /
                                  86_400_000,
                              )
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
                          <tr
                            key={doc.id}
                            className="border-b last:border-0 hover:bg-muted/30"
                          >
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
                                  ) : daysUntilExpiry !== null &&
                                    daysUntilExpiry <= 30 ? (
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
