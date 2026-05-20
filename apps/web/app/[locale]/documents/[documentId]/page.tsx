'use client';

import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { cn } from '../../../../src/lib/cn';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

type Tab = 'overview' | 'versions' | 'access';

export default function DocumentDetailPage() {
  const t = useTranslations('documents.detail');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string; documentId: string }>();
  const locale = params.locale ?? 'en';
  const documentId = params.documentId ?? '';
  const utils = trpc.useUtils();

  const canManage = useHasPermission('documents.manage');
  const [tab, setTab] = useState<Tab>('overview');

  const { data, isLoading } = trpc.documents.get.useQuery({ documentId });
  const { data: versionsData } = trpc.documents.versions.list.useQuery(
    { documentId },
    { enabled: tab === 'versions' },
  );
  const { data: accessData } = trpc.documents.access.list.useQuery(
    { documentId },
    { enabled: canManage && tab === 'access' },
  );

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

  if (isLoading || data === undefined) {
    return <Skeleton className="m-6 h-96 w-full" />;
  }

  const { document: doc, uploader, folderName, versions, isStale } = data;
  const isArchived = doc.archivedAt !== null;

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
              {isStale ? (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                  {t('staleBadge')}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('uploadedBy', { name: uploader?.name ?? '—' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
                {isArchived ? tCommon('restore' as never) : tCommon('archive')}
              </Button>
            ) : null}
          </div>
        </div>

        <nav className="flex gap-1 border-b">
          {(['overview', 'versions', 'access'] as const).map((t_) => (
            <TabButton
              key={t_}
              active={tab === t_}
              onClick={() => setTab(t_)}
              label={t(`tabs.${t_}`)}
            />
          ))}
        </nav>
      </header>

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
              <DetailRow label={t('fields.folder')}>{folderName ?? t('noFolder')}</DetailRow>
              <DetailRow label={t('fields.filename')}>{doc.filename}</DetailRow>
              <DetailRow label={t('fields.size')}>{formatBytes(doc.sizeBytes)}</DetailRow>
              <DetailRow label={t('fields.version')}>{t('versionNum', { n: String(doc.currentVersion) })}</DetailRow>
              <DetailRow label={t('fields.type')}>{doc.mimeType}</DetailRow>
              {doc.freshnessDays !== null ? (
                <DetailRow label={t('fields.freshness')}>
                  {t('freshnessValue', { days: String(doc.freshnessDays) })}
                </DetailRow>
              ) : null}
              {doc.labels !== null && Array.isArray(doc.labels) && doc.labels.length > 0 ? (
                <DetailRow label={t('fields.labels')}>
                  <div className="flex flex-wrap gap-1">
                    {(doc.labels as string[]).map((label) => (
                      <span
                        key={label}
                        className="rounded-full border bg-background px-2 py-0.5 text-xs"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </DetailRow>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

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
                    <td className="px-3 py-2 font-mono text-xs font-medium">{t('versionNum', { n: String(v.version) })}</td>
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
        'border-b-2 -mb-px px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[120px_1fr]">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}
