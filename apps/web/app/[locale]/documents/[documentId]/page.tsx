'use client';

import { ArrowLeft, FileUp, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
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

  const { data, isLoading } = trpc.documents.get.useQuery({ documentId });
  const { data: versionsData } = trpc.documents.versions.list.useQuery(
    { documentId },
    { enabled: tab === 'versions' },
  );
  const { data: accessData } = trpc.documents.access.list.useQuery(
    { documentId },
    { enabled: canManage && tab === 'access' },
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

  const { document: doc, uploader, responsibleUser, folderName, versions, isStale, isExpired, daysUntilExpiry } = data;
  const isArchived = doc.archivedAt !== null;

  const docLabelIds = Array.isArray(doc.labelIds) ? (doc.labelIds as string[]) : [];
  const docLabels = docLabelIds
    .map((id) => labelMap.get(id))
    .filter((l): l is NonNullable<typeof l> => l !== undefined);

  const docReminderDays = Array.isArray(doc.reminderDays)
    ? (doc.reminderDays as number[])
    : [];

  const responsibleGroupName =
    doc.responsibleGroupId !== null ? groupMap.get(doc.responsibleGroupId)?.name : undefined;

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/documents`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
      </div>

      {/* Header */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{doc.name}</h1>
              {isArchived ? (
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {t('archivedBadge')}
                </span>
              ) : null}
              {!isArchived && isExpired ? (
                <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200">
                  {t('expiredBadge')}
                </span>
              ) : !isArchived && daysUntilExpiry !== null && daysUntilExpiry <= 30 ? (
                <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                  {t('expiresInBadge', { days: String(daysUntilExpiry) })}
                </span>
              ) : null}
              {!isArchived && isStale ? (
                <span className="rounded-md bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900/40 dark:text-orange-100">
                  {t('staleBadge')}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('uploadedBy', { name: uploader?.name ?? '—' })}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {canManage && !isArchived ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowVersionDialog(true)}
              >
                <FileUp className="mr-1 h-4 w-4" />
                {t('uploadNewVersion')}
              </Button>
            ) : null}
            {canManage ? (
              <Button
                type="button"
                variant="outline"
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
        <nav className="flex gap-1 border-b">
          {(['overview', 'versions', 'access'] as const).map((tabKey) => (
            <TabButton
              key={tabKey}
              active={tab === tabKey}
              onClick={() => setTab(tabKey)}
              label={t(`tabs.${tabKey}`)}
            />
          ))}
        </nav>
      </header>

      {/* Upload-new-version dialog */}
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
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowVersionDialog(false)}
              >
                <X className="mr-1 h-4 w-4" />
                {tCommon('cancel')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Overview tab */}
      {tab === 'overview' ? (
        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <Card>
            <CardContent className="p-6">
              <h2 className="mb-3 text-base font-semibold">{t('descriptionHeading')}</h2>
              {doc.description.length > 0 ? (
                <p className="whitespace-pre-wrap text-sm">{doc.description}</p>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noDescription')}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-6 text-sm">
              <h2 className="text-base font-semibold">{t('detailsHeading')}</h2>

              <DetailRow label={t('fields.folder')}>
                {folderName ?? t('noFolder')}
              </DetailRow>
              <DetailRow label={t('fields.filename')}>{doc.filename}</DetailRow>
              <DetailRow label={t('fields.size')}>{formatBytes(doc.sizeBytes)}</DetailRow>
              <DetailRow label={t('fields.version')}>
                {t('versionNum', { n: String(doc.currentVersion) })}
              </DetailRow>
              <DetailRow label={t('fields.type')}>{doc.mimeType}</DetailRow>

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
                    {docReminderDays.sort((a, b) => a - b).map((days) => (
                      <span
                        key={days}
                        className="rounded-md bg-muted px-1.5 py-0.5 text-xs"
                      >
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
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Versions tab */}
      {tab === 'versions' ? (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">{t('versionColumns.version')}</th>
                  <th className="px-3 py-2 font-medium">{t('versionColumns.filename')}</th>
                  <th className="px-3 py-2 font-medium">{t('versionColumns.size')}</th>
                  <th className="px-3 py-2 font-medium">{t('versionColumns.uploadedBy')}</th>
                  <th className="px-3 py-2 font-medium">{t('versionColumns.uploadedAt')}</th>
                </tr>
              </thead>
              <tbody>
                {(versionsData ?? versions).map((v) => (
                  <tr key={v.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs font-medium">
                      {t('versionNum', { n: String(v.version) })}
                    </td>
                    <td className="px-3 py-2">{v.filename}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatBytes(v.sizeBytes)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {v.uploaderName ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(v.uploadedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {(versionsData ?? versions).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-muted-foreground">
                      {t('noVersions')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {/* Access tab */}
      {tab === 'access' ? (
        <Card>
          <CardContent className="p-6">
            <h2 className="mb-4 text-base font-semibold">{t('accessHeading')}</h2>
            {(accessData ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noAccessRules')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="pb-2 font-medium">{t('accessColumns.subject')}</th>
                    <th className="pb-2 font-medium">{t('accessColumns.permission')}</th>
                    <th className="pb-2 font-medium">{t('accessColumns.grantedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(accessData ?? []).map((a) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="py-2">
                        <span className="rounded-full border bg-background px-2 py-0.5 text-xs">
                          {a.subjectType}
                        </span>{' '}
                        {a.subjectId}
                      </td>
                      <td className="py-2 text-muted-foreground">{a.permission}</td>
                      <td className="py-2 text-muted-foreground">
                        {new Date(a.grantedAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

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
        '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-foreground font-semibold'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[140px_1fr]">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}
