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
import { Textarea } from '../../../../src/components/ui/textarea';
import { cn } from '../../../../src/lib/cn';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

type Tab = 'overview' | 'engagement' | 'comments';
type RecipientFilter = 'all' | 'viewed' | 'acknowledged' | 'signed' | 'not_viewed';

export default function HeadsUpDetailPage() {
  const t = useTranslations('headsUp.detail');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string; headsUpId: string }>();
  const locale = params.locale ?? 'en';
  const headsUpId = params.headsUpId ?? '';
  const utils = trpc.useUtils();

  const canManage = useHasPermission('headsUp.manage');
  const canPublish = useHasPermission('headsUp.publish');
  const canAnalytics = useHasPermission('headsUp.analytics.view');

  const [tab, setTab] = useState<Tab>('overview');
  const [recipientFilter, setRecipientFilter] = useState<RecipientFilter>('all');
  const [commentBody, setCommentBody] = useState('');

  const { data, isLoading } = trpc.headsUps.get.useQuery({ headsUpId });
  const { data: summary } = trpc.headsUps.engagementSummary.useQuery(
    { headsUpId },
    { enabled: canAnalytics && data?.headsUp.status === 'published' },
  );
  const { data: recipientsData } = trpc.headsUps.listRecipients.useQuery(
    { headsUpId, filter: recipientFilter },
    { enabled: canAnalytics && tab === 'engagement' },
  );
  const { data: commentsData } = trpc.headsUps.comments.list.useQuery(
    { headsUpId },
    { enabled: tab === 'comments' },
  );

  const publish = trpc.headsUps.publish.useMutation({
    onSuccess: () => {
      toast.success(t('publishToast'));
      void utils.headsUps.get.invalidate({ headsUpId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const archive = trpc.headsUps.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archiveToast'));
      void utils.headsUps.get.invalidate({ headsUpId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const createComment = trpc.headsUps.comments.create.useMutation({
    onSuccess: () => {
      setCommentBody('');
      toast.success(t('commentCreatedToast'));
      void utils.headsUps.comments.list.invalidate({ headsUpId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  if (isLoading || data === undefined) {
    return <Skeleton className="m-6 h-96 w-full" />;
  }

  const { headsUp, creatorName, recipientCount } = data;
  const isArchived = headsUp.status === 'archived';

  const RECIPIENT_FILTERS: ReadonlyArray<RecipientFilter> = [
    'all',
    'viewed',
    'not_viewed',
    'acknowledged',
    'signed',
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/heads-up`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{headsUp.title}</h1>
              <StatusBadge status={headsUp.status} t={t} />
              {isArchived ? (
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {t('archivedBadge')}
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {t('createdBy', { name: creatorName ?? '—' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canPublish && headsUp.status === 'draft' ? (
              <Button
                type="button"
                onClick={() => publish.mutate({ headsUpId })}
                disabled={publish.isPending}
              >
                {t('publishButton')}
              </Button>
            ) : null}
            {canManage && !isArchived ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => archive.mutate({ headsUpId })}
                disabled={archive.isPending}
              >
                {tCommon('archive')}
              </Button>
            ) : null}
          </div>
        </div>

        <nav className="flex gap-1 border-b">
          {(['overview', 'engagement', 'comments'] as const).map((t_) => (
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
              {headsUp.description.length > 0 ? (
                <p className="whitespace-pre-wrap text-sm">{headsUp.description}</p>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noDescription')}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-6 text-sm">
              <h2 className="text-base font-semibold">{t('detailsHeading')}</h2>
              <DetailRow label={t('fields.engagement')}>
                {t(`engagement.${headsUp.engagementLevel}`)}
              </DetailRow>
              <DetailRow label={t('fields.recipients')}>
                {String(recipientCount)}
              </DetailRow>
              {headsUp.publishAt !== null ? (
                <DetailRow label={t('fields.publishAt')}>
                  {new Date(headsUp.publishAt).toLocaleString()}
                </DetailRow>
              ) : null}
              {headsUp.expiresAt !== null ? (
                <DetailRow label={t('fields.expiresAt')}>
                  {new Date(headsUp.expiresAt).toLocaleString()}
                </DetailRow>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'engagement' ? (
        <div className="space-y-4">
          {summary !== undefined ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label={t('stats.total')} value={summary.total} />
              <StatCard label={t('stats.viewed')} value={summary.viewed} />
              {headsUp.requireAcknowledgement ? (
                <StatCard label={t('stats.acknowledged')} value={summary.acknowledged} />
              ) : null}
              {headsUp.requireSignature ? (
                <StatCard label={t('stats.signed')} value={summary.signed} />
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {RECIPIENT_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setRecipientFilter(f)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  recipientFilter === f
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-input bg-background text-muted-foreground hover:border-foreground'
                }`}
              >
                {t(`recipientFilter.${f}`)}
              </button>
            ))}
          </div>

          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">{t('recipientColumns.name')}</th>
                    <th className="px-3 py-2 font-medium">{t('recipientColumns.email')}</th>
                    <th className="px-3 py-2 font-medium">{t('recipientColumns.viewed')}</th>
                    {headsUp.requireAcknowledgement ? (
                      <th className="px-3 py-2 font-medium">
                        {t('recipientColumns.acknowledged')}
                      </th>
                    ) : null}
                    {headsUp.requireSignature ? (
                      <th className="px-3 py-2 font-medium">{t('recipientColumns.signed')}</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {(recipientsData ?? []).map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2">{r.userName ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.userEmail ?? '—'}</td>
                      <td className="px-3 py-2">
                        {r.viewedAt !== null ? (
                          <span className="text-emerald-600">
                            {new Date(r.viewedAt).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{t('notYet')}</span>
                        )}
                      </td>
                      {headsUp.requireAcknowledgement ? (
                        <td className="px-3 py-2">
                          {r.acknowledgedAt !== null ? (
                            <span className="text-emerald-600">
                              {new Date(r.acknowledgedAt).toLocaleDateString()}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{t('notYet')}</span>
                          )}
                        </td>
                      ) : null}
                      {headsUp.requireSignature ? (
                        <td className="px-3 py-2">
                          {r.signedAt !== null ? (
                            <span className="text-emerald-600">
                              {new Date(r.signedAt).toLocaleDateString()}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{t('notYet')}</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {(recipientsData ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground">
                        {t('noRecipients')}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'comments' ? (
        <div className="space-y-4">
          {!isArchived ? (
            <Card>
              <CardContent className="space-y-3 p-6">
                <Textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder={t('commentPlaceholder')}
                  rows={3}
                  maxLength={20_000}
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    disabled={commentBody.trim().length === 0 || createComment.isPending}
                    onClick={() =>
                      createComment.mutate({ headsUpId, body: commentBody.trim() })
                    }
                  >
                    {t('commentSubmit')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {(commentsData ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noComments')}</p>
          ) : (
            (commentsData ?? []).map((c) => (
              <Card key={c.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{c.authorName ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(c.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const classMap: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
    published: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
    archived: 'bg-muted text-muted-foreground',
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${classMap[status] ?? classMap['draft']}`}
    >
      {t(`status.${status}`)}
    </span>
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
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[140px_1fr]">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
