'use client';

import { File, FolderOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Input } from '../../../src/components/ui/input';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';

export default function DocumentsPage() {
  const t = useTranslations('documents.list');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canFolderManage = useHasPermission('documents.folders.manage');
  const utils = trpc.useUtils();

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);

  const { data: foldersData, isLoading: foldersLoading } = trpc.documentFolders.list.useQuery({
    parentId: null,
  });
  const folders = foldersData ?? [];

  const { data: docsData, isLoading: docsLoading } = trpc.documents.list.useQuery({
    folderId: selectedFolderId,
    query: query.trim().length > 0 ? query.trim() : undefined,
  });
  const docs = docsData ?? [];

  const createFolder = trpc.documentFolders.create.useMutation({
    onSuccess: () => {
      toast.success(t('folderCreatedToast'));
      setNewFolderName('');
      setShowNewFolder(false);
      void utils.documentFolders.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-6">
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
              onClick={() => setShowNewFolder(!showNewFolder)}
            >
              <FolderOpen className="mr-1 h-4 w-4" />
              {t('newFolderButton')}
            </Button>
          ) : null}
        </div>
      </header>

      {showNewFolder && canFolderManage ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Input
              placeholder={t('newFolderPlaceholder')}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              maxLength={500}
              className="max-w-xs"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newFolderName.trim().length > 0) {
                  createFolder.mutate({
                    name: newFolderName.trim(),
                    parentId: selectedFolderId ?? undefined,
                  });
                }
                if (e.key === 'Escape') setShowNewFolder(false);
              }}
            />
            <Button
              type="button"
              disabled={createFolder.isPending || newFolderName.trim().length === 0}
              onClick={() =>
                createFolder.mutate({
                  name: newFolderName.trim(),
                  parentId: selectedFolderId ?? undefined,
                })
              }
            >
              {tCommon('create')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowNewFolder(false)}
            >
              {tCommon('cancel')}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        {/* Folder tree */}
        <aside className="space-y-1">
          <button
            type="button"
            onClick={() => setSelectedFolderId(null)}
            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
              selectedFolderId === null
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            }`}
          >
            <FolderOpen className="h-4 w-4" />
            {t('allDocuments')}
          </button>
          {foldersLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => setSelectedFolderId(folder.id)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  selectedFolderId === folder.id
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

        {/* Document list */}
        <div className="space-y-4">
          <div className="relative">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
            />
          </div>

          {docsLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : docs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                {t('empty')}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">{t('columns.name')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.size')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.version')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.uploadedBy')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.updatedAt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((doc) => {
                      const isStale =
                        doc.freshnessDays !== null &&
                        (Date.now() - new Date(doc.updatedAt).getTime()) / 86_400_000 >
                          doc.freshnessDays;
                      return (
                        <tr key={doc.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-3 py-2">
                            <Link
                              href={`/${locale}/documents/${doc.id}`}
                              className="inline-flex items-center gap-2 font-medium hover:underline"
                            >
                              <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                              {doc.name}
                              {isStale ? (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                                  {t('staleTag')}
                                </span>
                              ) : null}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {formatBytes(doc.sizeBytes)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {t('versionNum', { n: String(doc.currentVersion) })}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {doc.uploaderName ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {new Date(doc.updatedAt).toLocaleDateString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
