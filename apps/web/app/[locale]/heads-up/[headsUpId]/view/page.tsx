'use client';

import { FileText, Film, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DetailNotFound } from '../../../../../src/components/detail-not-found';
import { EngagementBar } from '../../../../../src/components/heads-up/engagement-bar';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../../src/components/ui/textarea';
import { cn } from '../../../../../src/lib/cn';
import { trpc } from '../../../../../src/lib/trpc/client';

type EngagementLevel = 'view' | 'acknowledge' | 'sign';

const EMOJI_MAP: Record<string, string> = {
  celebrate: '🎉',
  clap: '👏',
  smile: '😄',
};

export default function HeadsUpRecipientViewPage() {
  const t = useTranslations('headsUp.inbox');
  const tDetail = useTranslations('headsUp.detail');
  const params = useParams<{ locale: string; headsUpId: string }>();
  const locale = params.locale ?? 'en';
  const headsUpId = params.headsUpId ?? '';
  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.headsUps.getForRecipient.useQuery({ headsUpId });

  const markViewed = trpc.headsUps.markViewed.useMutation({
    onSuccess: () => {
      toast.success(t('viewedToast'));
      void utils.headsUps.getForRecipient.invalidate({ headsUpId });
      void utils.headsUps.listForRecipient.invalidate();
    },
  });

  // Fire markViewed exactly once, and only after the query confirms this
  // user is genuinely a recipient (data resolved without a NOT_FOUND).
  const viewedFiredRef = useRef(false);
  const markViewedMutate = markViewed.mutate;
  useEffect(() => {
    if (data !== undefined && !viewedFiredRef.current) {
      viewedFiredRef.current = true;
      markViewedMutate({ headsUpId });
    }
  }, [data, headsUpId, markViewedMutate]);

  if (isLoading || data === undefined) {
    if (error !== null && error !== undefined) {
      return <DetailNotFound error={error} />;
    }
    return <Skeleton className="m-6 h-96 w-full" />;
  }

  const { headsUp, creatorName, attachments, documents, engagement } = data;
  const engagementLevel = headsUp.engagementLevel as EngagementLevel;

  return (
    <div className="space-y-6 pb-4">
      <div>
        <Link
          href={`/${locale}/heads-up`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          ← {t('backLink')}
        </Link>
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{headsUp.title}</h1>
          <EngagementChip
            engagementLevel={engagementLevel}
            viewedAt={engagement.viewedAt}
            acknowledgedAt={engagement.acknowledgedAt}
            signedAt={engagement.signedAt}
            t={t}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {tDetail('createdBy', { name: creatorName ?? '—' })}
        </p>
        {headsUp.publishAt !== null ? (
          <p className="text-xs text-muted-foreground">
            {new Date(headsUp.publishAt).toLocaleString(locale)}
          </p>
        ) : null}
      </header>

      <Card>
        <CardContent className="p-6">
          <h2 className="mb-3 text-base font-semibold">{tDetail('descriptionHeading')}</h2>
          {headsUp.description.length > 0 ? (
            <p className="whitespace-pre-wrap text-sm">{headsUp.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{tDetail('noDescription')}</p>
          )}

          {/* Attachments */}
          {attachments.length > 0 ? (
            <div className="mt-4 space-y-2 border-t pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {tDetail('attachmentsHeading')}
              </p>
              <div className="flex flex-wrap gap-3">
                {attachments.map((att) => {
                  const url = `/api/heads-up/attachment?attachmentId=${encodeURIComponent(att.id)}&disposition=inline`;
                  const isImage = att.mimeType.startsWith('image/');
                  const isVideo = att.mimeType.startsWith('video/');
                  return (
                    <a
                      key={att.id}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="group w-36 overflow-hidden rounded-md border bg-card transition-colors hover:border-primary/50"
                    >
                      <div className="relative flex h-24 items-center justify-center bg-muted/40">
                        {isImage ? (
                          <img
                            src={url}
                            alt={att.filename}
                            className="h-full w-full object-cover"
                          />
                        ) : isVideo ? (
                          <>
                            <Film className="h-8 w-8 text-muted-foreground" />
                            <span className="absolute rounded-full bg-black/60 p-1.5">
                              <Play className="h-3.5 w-3.5 fill-white text-white" />
                            </span>
                          </>
                        ) : (
                          <FileText className="h-8 w-8 text-muted-foreground" />
                        )}
                      </div>
                      <div className="p-2">
                        <p className="truncate text-xs font-medium" title={att.filename}>
                          {att.filename}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {tDetail('fileSizeKb', { kb: (att.sizeBytes / 1024).toFixed(0) })}
                        </p>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Library documents */}
          {documents.length > 0 ? (
            <div className="mt-4 space-y-2 border-t pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('documentsHeading')}
              </p>
              <ul className="space-y-1.5">
                {documents.map((doc) => (
                  <li
                    key={doc.documentId}
                    className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium" title={doc.name}>
                      {doc.name}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {t('documentVersion', { n: String(doc.documentVersion) })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {headsUp.allowReactions ? <ReactionsRow headsUpId={headsUpId} /> : null}
      {headsUp.allowComments ? <CommentsSection headsUpId={headsUpId} locale={locale} /> : null}

      <EngagementBar
        headsUpId={headsUpId}
        engagementLevel={engagementLevel}
        requireAcknowledgement={headsUp.requireAcknowledgement}
        requireSignature={headsUp.requireSignature}
        viewedAt={engagement.viewedAt}
        acknowledgedAt={engagement.acknowledgedAt}
        signedAt={engagement.signedAt}
      />
    </div>
  );
}

function EngagementChip({
  engagementLevel,
  viewedAt,
  acknowledgedAt,
  signedAt,
  t,
}: {
  engagementLevel: EngagementLevel;
  viewedAt: Date | string | null;
  acknowledgedAt: Date | string | null;
  signedAt: Date | string | null;
  t: (key: string) => string;
}) {
  let labelKey: string;
  let done: boolean;
  if (engagementLevel === 'sign') {
    done = signedAt !== null;
    labelKey = done ? 'signedBadge' : 'needsSign';
  } else if (engagementLevel === 'acknowledge') {
    done = acknowledgedAt !== null;
    labelKey = done ? 'acknowledgedBadge' : 'needsAck';
  } else {
    done = viewedAt !== null;
    labelKey = done ? 'viewedBadge' : 'needsView';
  }
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
        done
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100'
          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
      )}
    >
      {t(labelKey)}
    </span>
  );
}

function ReactionsRow({ headsUpId }: { headsUpId: string }) {
  const tCommon = useTranslations('common');
  const { data, refetch } = trpc.headsUps.reactions.list.useQuery({ headsUpId });
  const toggle = trpc.headsUps.reactions.toggle.useMutation({
    onSuccess: () => void refetch(),
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });
  if (data === undefined) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(EMOJI_MAP).map(([key, emoji]) => {
        const entry = data[key as keyof typeof data];
        const reactionCount = entry?.count ?? 0;
        const reacted = entry?.reacted ?? false;
        return (
          <button
            key={key}
            type="button"
            onClick={() =>
              toggle.mutate({ headsUpId, emoji: key as 'celebrate' | 'clap' | 'smile' })
            }
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
              reacted
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:bg-muted',
            )}
          >
            {emoji}
            {reactionCount > 0 ? (
              <span className="text-xs text-muted-foreground">{reactionCount}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function CommentsSection({ headsUpId, locale }: { headsUpId: string; locale: string }) {
  const t = useTranslations('headsUp.inbox');
  const tDetail = useTranslations('headsUp.detail');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();
  const [body, setBody] = useState('');

  const { data, error } = trpc.headsUps.comments.list.useQuery({ headsUpId });
  const create = trpc.headsUps.comments.create.useMutation({
    onSuccess: () => {
      setBody('');
      toast.success(tDetail('commentCreatedToast'));
      void utils.headsUps.comments.list.invalidate({ headsUpId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">{t('commentsHeading')}</h2>
      <Card>
        <CardContent className="space-y-3 p-4">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={tDetail('commentPlaceholder')}
            rows={3}
            maxLength={20_000}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={body.trim().length === 0 || create.isPending}
              onClick={() => create.mutate({ headsUpId, body: body.trim() })}
            >
              {tDetail('commentSubmit')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error !== null ? (
        <p className="text-sm text-destructive">{tCommon('error')}</p>
      ) : (data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{tDetail('noComments')}</p>
      ) : (
        (data ?? []).map((c) => (
          <Card key={c.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{c.authorName ?? '—'}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(c.createdAt).toLocaleString(locale)}
                </p>
              </div>
              <p className="whitespace-pre-wrap text-sm">{c.body}</p>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
