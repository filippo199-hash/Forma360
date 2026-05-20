'use client';

import { Copy, Link2, Link2Off } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Separator } from '../../../../src/components/ui/separator';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { cn } from '../../../../src/lib/cn';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

type Tab = 'overview' | 'engagement' | 'comments';
type RecipientFilter = 'all' | 'viewed' | 'acknowledged' | 'signed' | 'not_viewed';

const EMOJI_MAP: Record<string, string> = {
  celebrate: '🎉',
  clap: '👏',
  smile: '😄',
};

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
  const { data: reactionsData, refetch: refetchReactions } = trpc.headsUps.reactions.list.useQuery(
    { headsUpId },
    { enabled: tab === 'overview' },
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

  const createShareLink = trpc.headsUps.createShareLink.useMutation({
    onSuccess: () => {
      toast.success(t('shareLink.created'));
      void utils.headsUps.get.invalidate({ headsUpId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const disableShareLink = trpc.headsUps.disableShareLink.useMutation({
    onSuccess: () => {
      void utils.headsUps.get.invalidate({ headsUpId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const toggleReaction = trpc.headsUps.reactions.toggle.useMutation({
    onSuccess: () => void refetchReactions(),
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const sendReminder = trpc.headsUps.sendReminder.useMutation({
    onSuccess: (result) => {
      const msg =
        result.count > 1
          ? t('remindAllSentToast', { count: String(result.count) })
          : t('reminderSentToast');
      toast.success(msg);
      void utils.headsUps.listRecipients.invalidate({ headsUpId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  if (isLoading || data === undefined) {
    return <Skeleton className="m-6 h-96 w-full" />;
  }

  const { headsUp, creatorName, recipientCount, attachments } = data;
  const isArchived = headsUp.status === 'archived';
  const engagementLevel = headsUp.engagementLevel as 'view' | 'acknowledge' | 'sign';

  /** Determine if a recipient row is "pending" based on the engagement level. */
  function isPending(r: {
    viewedAt: Date | string | null;
    acknowledgedAt: Date | string | null;
    signedAt: Date | string | null;
  }): boolean {
    if (engagementLevel === 'sign') return r.signedAt === null;
    if (engagementLevel === 'acknowledge') return r.acknowledgedAt === null;
    return r.viewedAt === null;
  }

  const RECIPIENT_FILTERS: ReadonlyArray<RecipientFilter> = [
    'all',
    'viewed',
    'not_viewed',
    'acknowledged',
    'signed',
  ];

  function copyShareLink(token: string) {
    const url = `${window.location.origin}/s/${token}`;
    void navigator.clipboard.writeText(url).then(() => {
      toast.success(t('shareLink.copied'));
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/heads-up`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          ← {t('backLink')}
        </Link>
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{headsUp.title}</h1>
              <StatusBadge status={headsUp.status} t={t} />
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
        <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
          {/* Main content */}
          <div className="space-y-6">
            <Card>
              <CardContent className="p-6">
                <h2 className="mb-3 text-base font-semibold">{t('descriptionHeading')}</h2>
                {headsUp.description.length > 0 ? (
                  <p className="whitespace-pre-wrap text-sm">{headsUp.description}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('noDescription')}</p>
                )}

                {/* Attachments */}
                {attachments.length > 0 ? (
                  <div className="mt-4 space-y-2 border-t pt-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {t('attachmentsHeading')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {attachments.map((att) => (
                        <div
                          key={att.id}
                          className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs"
                        >
                          <span>{att.filename}</span>
                          <span className="text-muted-foreground">
                            {(att.sizeBytes / 1024).toFixed(0)} KB
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Reactions */}
                {headsUp.allowReactions && reactionsData !== undefined ? (
                  <div className="mt-4 border-t pt-4">
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(EMOJI_MAP).map(([key, emoji]) => {
                        const entry = reactionsData[key as keyof typeof reactionsData];
                        const count = entry?.count ?? 0;
                        const reacted = entry?.reacted ?? false;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() =>
                              toggleReaction.mutate({
                                headsUpId,
                                emoji: key as 'celebrate' | 'clap' | 'smile',
                              })
                            }
                            className={cn(
                              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                              reacted
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border hover:bg-muted',
                            )}
                          >
                            {emoji}
                            {count > 0 ? (
                              <span className="text-xs text-muted-foreground">{count}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* Share externally — full-width card */}
            {canManage ? (
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="mb-0.5 text-sm font-semibold">{t('shareLink.section')}</h2>
                      <p className="text-xs text-muted-foreground">{t('shareLink.hint')}</p>
                    </div>
                    {headsUp.shareToken === null ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={createShareLink.isPending}
                        onClick={() => createShareLink.mutate({ headsUpId })}
                      >
                        <Link2 className="mr-1.5 h-3.5 w-3.5" />
                        {t('shareLink.createButton')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disableShareLink.isPending}
                        onClick={() => disableShareLink.mutate({ headsUpId })}
                        className="text-destructive hover:text-destructive"
                      >
                        <Link2Off className="mr-1.5 h-3.5 w-3.5" />
                        {t('shareLink.disableButton')}
                      </Button>
                    )}
                  </div>

                  {headsUp.shareToken !== null ? (
                    <div className="mt-4 flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                      <code className="flex-1 truncate text-xs">
                        {typeof window !== 'undefined'
                          ? `${window.location.origin}/s/${headsUp.shareToken}`
                          : `/s/${headsUp.shareToken}`}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyShareLink(headsUp.shareToken!)}
                      >
                        <Copy className="mr-1 h-3.5 w-3.5" />
                        {t('shareLink.copyButton')}
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </div>

          {/* Sidebar */}
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
              <Separator />
              <DetailRow label={t('fields.comments')}>
                {headsUp.allowComments ? tCommon('enabled') : tCommon('disabled')}
              </DetailRow>
              <DetailRow label={t('fields.reactions')}>
                {headsUp.allowReactions ? tCommon('enabled') : tCommon('disabled')}
              </DetailRow>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'engagement' ? (
        <div className="space-y-4">
          {summary !== undefined ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label={t('stats.total')}
                value={summary.total}
                subLabel={null}
                total={summary.total}
              />
              <StatCard
                label={t('stats.viewed')}
                value={summary.viewed}
                subLabel={
                  summary.notViewed > 0
                    ? `${String(summary.notViewed)} ${t('stats.notViewed')}`
                    : null
                }
                total={summary.total}
              />
              {engagementLevel === 'acknowledge' || engagementLevel === 'sign' ? (
                <StatCard
                  label={t('stats.acknowledged')}
                  value={summary.acknowledged}
                  subLabel={
                    summary.notAcknowledged > 0
                      ? `${String(summary.notAcknowledged)} ${t('stats.notAcknowledged')}`
                      : null
                  }
                  total={summary.total}
                />
              ) : null}
              {engagementLevel === 'sign' ? (
                <StatCard
                  label={t('stats.signed')}
                  value={summary.signed}
                  subLabel={
                    summary.notSigned > 0
                      ? `${String(summary.notSigned)} ${t('stats.notSigned')}`
                      : null
                  }
                  total={summary.total}
                />
              ) : null}
            </div>
          ) : null}

          {/* Remind all button */}
          {canManage && headsUp.status === 'published' ? (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={sendReminder.isPending}
                onClick={() => sendReminder.mutate({ headsUpId })}
              >
                {t('remindAllButton')}
              </Button>
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
                    {engagementLevel === 'acknowledge' || engagementLevel === 'sign' ? (
                      <th className="px-3 py-2 font-medium">
                        {t('recipientColumns.acknowledged')}
                      </th>
                    ) : null}
                    {engagementLevel === 'sign' ? (
                      <th className="px-3 py-2 font-medium">{t('recipientColumns.signed')}</th>
                    ) : null}
                    <th className="px-3 py-2 font-medium">{t('recipientColumns.lastReminder')}</th>
                    {canManage && headsUp.status === 'published' ? (
                      <th className="px-3 py-2 font-medium">{t('recipientColumns.actions')}</th>
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
                      {engagementLevel === 'acknowledge' || engagementLevel === 'sign' ? (
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
                      {engagementLevel === 'sign' ? (
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
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.reminderLastSentAt !== null && r.reminderLastSentAt !== undefined
                          ? new Date(r.reminderLastSentAt).toLocaleDateString()
                          : '—'}
                      </td>
                      {canManage && headsUp.status === 'published' ? (
                        <td className="px-3 py-2">
                          {isPending(r) ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={sendReminder.isPending}
                              onClick={() =>
                                sendReminder.mutate({ headsUpId, userId: r.userId })
                              }
                            >
                              {t('remindButton')}
                            </Button>
                          ) : (
                            <span className="text-xs text-emerald-600">✓ Done</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {(recipientsData ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-muted-foreground">
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
          {!isArchived && headsUp.allowComments ? (
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
        '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
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

function StatCard({
  label,
  value,
  subLabel,
  total,
}: {
  label: string;
  value: number;
  subLabel: string | null;
  total: number;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">
          {label}
          {total > 0 ? <span className="ml-1 opacity-60">/ {total}</span> : null}
        </p>
        {subLabel !== null ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{subLabel}</p>
        ) : null}
        <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
          <div
            className="h-1.5 rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
