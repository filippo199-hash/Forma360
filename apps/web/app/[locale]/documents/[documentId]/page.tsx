'use client';

import { ArrowLeft, Download, FileText, FileUp, Film, Image as ImageIcon, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { GroupUserSelector } from '../../../../src/components/selectors/group-user-selector';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { Button } from '../../../../src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../../src/components/ui/dialog';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { cn } from '../../../../src/lib/cn';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

const MAX_BYTES = 50 * 1024 * 1024;

type Tab = 'overview' | 'versions' | 'access';

/** Classify a MIME type for the preview renderer. */
function previewKind(mimeType: string): 'pdf' | 'image' | 'video' | 'text' | 'none' {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('text/')) return 'text';
  return 'none';
}

// ─── Preview panel ────────────────────────────────────────────────────────────

function DocumentPreview({
  documentId,
  mimeType,
  filename,
}: {
  documentId: string;
  mimeType: string;
  filename: string;
}) {
  const t = useTranslations('documents.detail');
  const kind = previewKind(mimeType);
  const base = `/api/documents/download?documentId=${encodeURIComponent(documentId)}`;
  const inlineUrl = `${base}&disposition=inline`;
  const downloadUrl = `${base}&disposition=attachment`;

  if (kind === 'pdf' || kind === 'text') {
    return (
      <iframe
        src={inlineUrl}
        title={filename}
        className="h-full w-full border-0"
        sandbox="allow-scripts allow-same-origin"
      />
    );
  }

  if (kind === 'image') {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={inlineUrl}
          alt={filename}
          className="max-h-full max-w-full rounded-md object-contain shadow-sm"
        />
      </div>
    );
  }

  if (kind === 'video') {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video src={inlineUrl} controls className="max-h-full max-w-full rounded-md shadow-sm" />
      </div>
    );
  }

  // Unsupported — show a fallback card with a download link.
  const Icon = mimeType.startsWith('image/')
    ? ImageIcon
    : mimeType.startsWith('video/')
      ? Film
      : FileText;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 text-center">
      <div className="rounded-full bg-muted p-6">
        <Icon className="h-10 w-10 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{t('previewUnavailable')}</p>
        <p className="text-xs text-muted-foreground">{mimeType}</p>
      </div>
      <a href={downloadUrl} download={filename}>
        <Button variant="outline" size="sm">
          <Download className="mr-1.5 h-4 w-4" />
          {t('downloadFile')}
        </Button>
      </a>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DocumentDetailPage() {
  const t = useTranslations('documents.detail');
  const tUpload = useTranslations('documents.upload');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string; documentId: string }>();
  const locale = params.locale ?? 'en';
  const documentId = params.documentId ?? '';
  const utils = trpc.useUtils();

  const canManage = useHasPermission('documents.manage');
  const [tab, setTab] = useState<Tab>('overview');

  // Upload-new-version dialog
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showVersionDialog, setShowVersionDialog] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Access-tab visibility editor + move dialog (To-Do #5).
  const [visGroupIds, setVisGroupIds] = useState<string[]>([]);
  const [visSiteIds, setVisSiteIds] = useState<string[]>([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveFolderId, setMoveFolderId] = useState<string>('');

  const { data, isLoading } = trpc.documents.get.useQuery({ documentId });
  const { data: versionsData } = trpc.documents.versions.list.useQuery(
    { documentId },
    { enabled: tab === 'versions' },
  );
  const { data: allLabels = [] } = trpc.documentLabels.list.useQuery();
  const { data: allGroups = [] } = trpc.groups.list.useQuery();
  const labelMap = new Map(allLabels.map((l) => [l.id, l]));
  const groupMap = new Map(allGroups.map((g) => [g.id, g]));

  const archive = trpc.documents.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archiveToast'));
      void utils.documents.get.invalidate({ documentId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const restore = trpc.documents.restore.useMutation({
    onSuccess: () => {
      toast.success(t('restoreToast'));
      void utils.documents.get.invalidate({ documentId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const uploadVersion = trpc.documents.uploadVersion.useMutation({
    onSuccess: () => {
      toast.success(tUpload('newVersionSuccessToast'));
      setShowVersionDialog(false);
      void utils.documents.get.invalidate({ documentId });
      void utils.documents.versions.list.invalidate({ documentId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tUpload('errorToast')),
  });

  // All folders for the Move dialog (parentId omitted → whole tenant tree).
  const { data: allFolders = [] } = trpc.documentFolders.list.useQuery({});

  const updateDoc = trpc.documents.update.useMutation({
    onSuccess: () => {
      void utils.documents.get.invalidate({ documentId });
      void utils.documents.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  // Seed the visibility editor from the loaded document.
  useEffect(() => {
    if (data?.document !== undefined) {
      const g = data.document.visibleToGroupIds;
      const s = data.document.visibleToSiteIds;
      setVisGroupIds(Array.isArray(g) ? (g as string[]) : []);
      setVisSiteIds(Array.isArray(s) ? (s as string[]) : []);
      setMoveFolderId(data.document.folderId ?? '');
    }
  }, [data]);

  async function handleVersionFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file === undefined) return;
    if (file.size > MAX_BYTES) {
      toast.error(tUpload('fileSizeError'));
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('upload-failed');
      const result = (await res.json()) as {
        storageKey: string;
        filename: string;
        mimeType: string;
        sizeBytes: number;
      };
      uploadVersion.mutate({
        documentId,
        storageKey: result.storageKey,
        filename: result.filename,
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
      });
    } catch {
      toast.error(tUpload('errorToast'));
    } finally {
      setIsUploading(false);
    }
  }

  if (isLoading || data === undefined) {
    return <Skeleton className="m-6 h-96 w-full" />;
  }

  const {
    document: doc,
    uploader,
    responsibleUser,
    folderName,
    versions,
    isStale,
    isExpired,
    daysUntilExpiry,
  } = data;
  const isArchived = doc.archivedAt !== null;

  const docLabelIds = Array.isArray(doc.labelIds) ? (doc.labelIds as string[]) : [];
  const docLabels = docLabelIds
    .map((id) => labelMap.get(id))
    .filter((l): l is NonNullable<typeof l> => l !== undefined);
  const docReminderDays = Array.isArray(doc.reminderDays) ? (doc.reminderDays as number[]) : [];
  const responsibleGroupName =
    doc.responsibleGroupId !== null ? groupMap.get(doc.responsibleGroupId)?.name : undefined;

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    // Break out of page padding to go edge-to-edge
    <div className="-mx-4 -mb-6 -mt-6 flex flex-col" style={{ height: 'calc(100vh - 0px)' }}>
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-3 border-b bg-background px-4 py-2.5">
        <Link
          href={`/${locale}/documents`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
      </div>

      {/* ── Split view ─────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Left — document preview ───────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-hidden border-r bg-muted/20">
          <DocumentPreview
            documentId={documentId}
            mimeType={doc.mimeType}
            filename={doc.filename}
          />
        </div>

        {/* Right — details panel ─────────────────────────────── */}
        <div className="flex w-[380px] shrink-0 flex-col overflow-y-auto">
          {/* Header */}
          <div className="shrink-0 space-y-3 border-b p-5">
            <div>
              <div className="flex flex-wrap items-start gap-2">
                <h1 className="text-lg font-semibold leading-snug tracking-tight">{doc.name}</h1>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {isArchived ? (
                  <StatusBadge variant="muted">{t('archivedBadge')}</StatusBadge>
                ) : null}
                {!isArchived && isExpired ? (
                  <StatusBadge variant="red">{t('expiredBadge')}</StatusBadge>
                ) : !isArchived && daysUntilExpiry !== null && daysUntilExpiry <= 30 ? (
                  <StatusBadge variant="amber">
                    {t('expiresInBadge', { days: String(daysUntilExpiry) })}
                  </StatusBadge>
                ) : null}
                {!isArchived && isStale ? (
                  <StatusBadge variant="orange">{t('staleBadge')}</StatusBadge>
                ) : null}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('uploadedBy', { name: uploader?.name ?? '—' })}
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {canManage && !isArchived ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowVersionDialog(true)}
                >
                  <FileUp className="mr-1.5 h-3.5 w-3.5" />
                  {t('uploadNewVersion')}
                </Button>
              ) : null}
              <a
                href={`/api/documents/download?documentId=${documentId}&disposition=attachment`}
                download={doc.filename}
              >
                <Button type="button" variant="outline" size="sm">
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {t('downloadFile')}
                </Button>
              </a>
              {canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (isArchived) restore.mutate({ documentId });
                    else archive.mutate({ documentId });
                  }}
                  disabled={archive.isPending || restore.isPending}
                >
                  {isArchived ? tCommon('save') : tCommon('archive')}
                </Button>
              ) : null}
            </div>
          </div>

          {/* Tab bar */}
          <nav className="flex shrink-0 border-b px-2">
            {(['overview', 'versions', 'access'] as const).map((tabKey) => (
              <TabButton
                key={tabKey}
                active={tab === tabKey}
                onClick={() => setTab(tabKey)}
                label={t(`tabs.${tabKey}`)}
              />
            ))}
          </nav>

          {/* Tab content */}
          <div className="flex-1 p-5">
            {/* ── Overview tab ── */}
            {tab === 'overview' ? (
              <div className="space-y-5">
                {doc.description.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('descriptionHeading')}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{doc.description}</p>
                  </div>
                ) : null}

                <div className="space-y-3 text-sm">
                  <DetailRow label={t('fields.folder')}>
                    <span className="flex items-center gap-2">
                      <span>{folderName ?? t('noFolder')}</span>
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => setMoveOpen(true)}
                          className="text-xs text-primary hover:underline"
                        >
                          {t('moveButton')}
                        </button>
                      ) : null}
                    </span>
                  </DetailRow>
                  <DetailRow label={t('fields.filename')}>
                    <span className="truncate font-mono text-xs">{doc.filename}</span>
                  </DetailRow>
                  <DetailRow label={t('fields.size')}>{formatBytes(doc.sizeBytes)}</DetailRow>
                  <DetailRow label={t('fields.version')}>
                    {t('versionNum', { n: String(doc.currentVersion) })}
                  </DetailRow>
                  <DetailRow label={t('fields.type')}>
                    <span className="text-xs">{doc.mimeType}</span>
                  </DetailRow>

                  {doc.startDate !== null ? (
                    <DetailRow label={t('fields.startDate')}>
                      {new Date(doc.startDate).toLocaleDateString()}
                    </DetailRow>
                  ) : null}

                  {doc.expiresAt !== null ? (
                    <DetailRow label={t('fields.expiresAt')}>
                      <span
                        className={
                          isExpired
                            ? 'font-medium text-red-600 dark:text-red-400'
                            : daysUntilExpiry !== null && daysUntilExpiry <= 30
                              ? 'font-medium text-amber-600 dark:text-amber-400'
                              : ''
                        }
                      >
                        {new Date(doc.expiresAt).toLocaleDateString()}
                        {isExpired ? ` (${t('expiredBadge').toLowerCase()})` : ''}
                      </span>
                    </DetailRow>
                  ) : null}

                  {responsibleUser !== null ? (
                    <DetailRow label={t('fields.responsible')}>
                      {responsibleUser.name ?? responsibleUser.email}
                    </DetailRow>
                  ) : responsibleGroupName !== undefined ? (
                    <DetailRow label={t('fields.responsible')}>{responsibleGroupName}</DetailRow>
                  ) : null}

                  {docReminderDays.length > 0 ? (
                    <DetailRow label={t('fields.reminderDays')}>
                      <div className="flex flex-wrap gap-1">
                        {docReminderDays
                          .sort((a, b) => a - b)
                          .map((days) => (
                            <span key={days} className="rounded-md bg-muted px-1.5 py-0.5 text-xs">
                              {t('fields.reminderDaysValue', { days: String(days) })}
                            </span>
                          ))}
                      </div>
                    </DetailRow>
                  ) : null}

                  {doc.freshnessDays !== null ? (
                    <DetailRow label={t('fields.freshness')}>
                      {t('freshnessValue', { days: String(doc.freshnessDays) })}
                    </DetailRow>
                  ) : null}

                  {docLabels.length > 0 ? (
                    <DetailRow label={t('fields.labels')}>
                      <div className="flex flex-wrap gap-1">
                        {docLabels.map((lbl) => (
                          <span
                            key={lbl.id}
                            className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                            style={{ backgroundColor: lbl.color }}
                          >
                            {lbl.name}
                          </span>
                        ))}
                      </div>
                    </DetailRow>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* ── Versions tab ── */}
            {tab === 'versions' ? (
              <div className="space-y-2">
                {(versionsData ?? versions).length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noVersions')}</p>
                ) : (
                  (versionsData ?? versions).map((v) => (
                    <div
                      key={v.id}
                      className={cn(
                        'rounded-md border p-3 text-xs',
                        v.version === doc.currentVersion && 'border-primary/30 bg-primary/5',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold">
                          {t('versionNum', { n: String(v.version) })}
                          {v.version === doc.currentVersion ? (
                            <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                              {t('currentVersionBadge')}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground">{formatBytes(v.sizeBytes)}</span>
                      </div>
                      <p className="mt-1 truncate text-muted-foreground">{v.filename}</p>
                      <p className="mt-0.5 text-muted-foreground">
                        {v.uploaderName ?? '—'} · {new Date(v.uploadedAt).toLocaleDateString()}
                      </p>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            {/* ── Access tab ── */}
            {tab === 'access' ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold">{t('visibilityHeading')}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t('visibilityHelp')}</p>
                </div>
                {visGroupIds.length === 0 && visSiteIds.length === 0 ? (
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('visibleToEveryone')}
                  </p>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <GroupUserSelector
                      value={visGroupIds}
                      onChange={setVisGroupIds}
                      mode="groups"
                      label={t('visGroupsLabel')}
                      disabled={!canManage}
                    />
                  </div>
                  <div>
                    <SiteSelector
                      value={visSiteIds}
                      onChange={setVisSiteIds}
                      label={t('visSitesLabel')}
                      disabled={!canManage}
                    />
                  </div>
                </div>
                {canManage ? (
                  <Button
                    size="sm"
                    disabled={updateDoc.isPending}
                    onClick={() => {
                      updateDoc.mutate(
                        {
                          documentId,
                          visibleToGroupIds: visGroupIds,
                          visibleToSiteIds: visSiteIds,
                        },
                        { onSuccess: () => toast.success(t('savedToast')) },
                      );
                    }}
                  >
                    {t('saveVisibility')}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Upload-new-version dialog ─────────────────────────── */}
      <Dialog open={showVersionDialog} onOpenChange={setShowVersionDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{tUpload('newVersionTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors hover:border-primary/60 hover:bg-muted/40"
            >
              {isUploading || uploadVersion.isPending ? (
                <p className="text-sm text-muted-foreground">{tUpload('uploadingText')}</p>
              ) : (
                <>
                  <FileUp className="mb-2 h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">{tUpload('filePlaceholder')}</p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleVersionFileChange}
                disabled={isUploading || uploadVersion.isPending}
              />
            </div>
            <div className="flex justify-end">
              <Button type="button" variant="ghost" onClick={() => setShowVersionDialog(false)}>
                <X className="mr-1 h-4 w-4" />
                {tCommon('cancel')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Move-to-folder dialog (To-Do #5) ─────────────────────── */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('moveTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <select
              value={moveFolderId}
              onChange={(e) => setMoveFolderId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">{t('moveNoFolder')}</option>
              {allFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <Button
              className="w-full"
              disabled={updateDoc.isPending}
              onClick={() => {
                updateDoc.mutate(
                  { documentId, folderId: moveFolderId === '' ? null : moveFolderId },
                  {
                    onSuccess: () => {
                      toast.success(t('movedToast'));
                      setMoveOpen(false);
                    },
                  },
                );
              }}
            >
              {t('moveSave')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-2.5 text-xs font-medium transition-colors',
        active
          ? 'border-foreground font-semibold text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function StatusBadge({
  variant,
  children,
}: {
  variant: 'muted' | 'red' | 'amber' | 'orange';
  children: React.ReactNode;
}) {
  const classes: Record<typeof variant, string> = {
    muted: 'bg-muted text-muted-foreground',
    red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
    orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-100',
  };
  return (
    <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', classes[variant])}>
      {children}
    </span>
  );
}
