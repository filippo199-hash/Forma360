'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '../../../src/components/ui/button';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../src/lib/permissions-context';
import { trpc } from '../../../src/lib/trpc/client';

type StatusFilter = 'all' | 'draft' | 'published' | 'archived';
type FeedFilter = 'all' | 'pending' | 'done';
type ViewMode = 'feed' | 'manage';

const STATUS_OPTIONS: ReadonlyArray<StatusFilter> = ['all', 'draft', 'published', 'archived'];
const FEED_FILTERS: ReadonlyArray<FeedFilter> = ['all', 'pending', 'done'];

export default function HeadsUpListPage() {
  const t = useTranslations('headsUp.list');
  const tInbox = useTranslations('headsUp.inbox');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canPublish = useHasPermission('headsUp.publish');
  const canManage = useHasPermission('headsUp.manage');
  const canSeeManage = canPublish || canManage;

  // Default users (no publish/manage rights) only ever see their own feed.
  const [mode, setMode] = useState<ViewMode>('feed');
  const activeMode: ViewMode = canSeeManage ? mode : 'feed';

  return (
    <div className="space-y-4 sm:space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">{t('subtitle')}</p>
        </div>
        {canPublish && activeMode === 'manage' ? (
          <Button asChild>
            <Link href={`/${locale}/heads-up/new`}>
              <Plus className="mr-1 h-4 w-4" />
              {t('newButton')}
            </Link>
          </Button>
        ) : null}
      </header>

      {canSeeManage ? (
        <div className="inline-flex gap-1 rounded-lg border bg-muted/40 p-1">
          {(['feed', 'manage'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeMode === m
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {m === 'feed' ? tInbox('tabMyFeed') : tInbox('tabManage')}
            </button>
          ))}
        </div>
      ) : null}

      {activeMode === 'manage' ? (
        <ManageList locale={locale} canPublish={canPublish} t={t} />
      ) : (
        <RecipientFeed locale={locale} tInbox={tInbox} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recipient feed ("My feed")                                          */
/* ------------------------------------------------------------------ */

type FeedItem = {
  id: string;
  title: string;
  engagementLevel: string;
  requireAcknowledgement: boolean;
  requireSignature: boolean;
  publishAt: Date | string | null;
  expiresAt: Date | string | null;
  creatorName: string | null;
  viewedAt: Date | string | null;
  acknowledgedAt: Date | string | null;
  signedAt: Date | string | null;
  pending: boolean;
};

function RecipientFeed({ locale, tInbox }: { locale: string; tInbox: (key: string) => string }) {
  const [filter, setFilter] = useState<FeedFilter>('all');
  const { data, isLoading, error } = trpc.headsUps.listForRecipient.useQuery({ filter });
  const rows = data ?? [];

  return (
    <div className="space-y-4">
      <h2 className="sr-only">{tInbox('feedTitle')}</h2>
      <div className="flex flex-wrap gap-2">
        {FEED_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              filter === f
                ? 'border-foreground bg-foreground text-background'
                : 'border-input bg-background text-muted-foreground hover:border-foreground'
            }`}
          >
            {tInbox(f === 'all' ? 'filterAll' : f === 'pending' ? 'filterPending' : 'filterDone')}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {tInbox('loadError')}
        </p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>{tInbox('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Link key={row.id} href={`/${locale}/heads-up/${row.id}/view`} className="block">
              <Card className="transition-colors hover:bg-muted/30">
                <CardContent className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-medium">{row.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.creatorName ?? '—'}
                      {row.publishAt !== null
                        ? ` · ${new Date(row.publishAt).toLocaleDateString(locale)}`
                        : ''}
                    </p>
                  </div>
                  <FeedChip item={row} tInbox={tInbox} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function FeedChip({ item, tInbox }: { item: FeedItem; tInbox: (key: string) => string }) {
  let labelKey: string;
  let done: boolean;
  if (item.engagementLevel === 'sign') {
    done = item.signedAt !== null;
    labelKey = done ? 'signedBadge' : 'needsSign';
  } else if (item.engagementLevel === 'acknowledge') {
    done = item.acknowledgedAt !== null;
    labelKey = done ? 'acknowledgedBadge' : 'needsAck';
  } else {
    done = item.viewedAt !== null;
    labelKey = done ? 'viewedBadge' : 'needsView';
  }
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        done
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100'
          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100'
      }`}
    >
      {tInbox(labelKey)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Management list ("Manage")                                          */
/* ------------------------------------------------------------------ */

function ManageList({
  locale,
  canPublish,
  t,
}: {
  locale: string;
  canPublish: boolean;
  t: (key: string) => string;
}) {
  const [status, setStatus] = useState<StatusFilter>('all');

  const { data, isLoading, error } = trpc.headsUps.list.useQuery({
    status: status === 'all' ? undefined : status,
  });

  const rows = data ?? [];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              status === s
                ? 'border-foreground bg-foreground text-background'
                : 'border-input bg-background text-muted-foreground hover:border-foreground'
            }`}
          >
            {t(`status.${s}`)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {t('loadError')}
        </p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>{t('empty')}</p>
            {canPublish ? (
              <Link
                href={`/${locale}/heads-up/new`}
                className="mt-2 inline-block text-foreground underline-offset-4 hover:underline"
              >
                {t('emptyCta')}
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Table (desktop) — hidden under md; the card list takes over there. */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">{t('columns.title')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.status')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.audience')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.engagement')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.createdBy')}</th>
                      <th className="px-3 py-2 font-medium">{t('columns.createdAt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium">
                          <Link href={`/${locale}/heads-up/${row.id}`} className="hover:underline">
                            {row.title}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={row.status} t={t} />
                        </td>
                        <td className="px-3 py-2">
                          <AudienceCell audience={row.audience} t={t} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {t(`engagement.${row.engagementLevel}`)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.creatorName ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {new Date(row.createdAt).toLocaleDateString(locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Card list (mobile) — stacked layout under md; the table is hidden there. */}
          <div className="space-y-3 md:hidden">
            {rows.map((row) => (
              <Link key={row.id} href={`/${locale}/heads-up/${row.id}`} className="block">
                <Card className="transition-colors hover:bg-muted/30">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 font-medium">{row.title}</p>
                      <StatusBadge status={row.status} t={t} />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-foreground">
                        {t('columns.audience')}
                      </div>
                      <AudienceCell audience={row.audience} t={t} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('columns.createdAt')}: {new Date(row.createdAt).toLocaleDateString(locale)}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const MAX_AUDIENCE_CHIPS = 3;

function AudienceCell({
  audience,
  t,
}: {
  audience: { groupNames: string[]; siteNames: string[]; hasIndividualUsers: boolean };
  t: (k: string) => string;
}) {
  const allNames = [...audience.groupNames, ...audience.siteNames];
  if (audience.hasIndividualUsers && allNames.length === 0) {
    return <span className="text-xs text-muted-foreground">{t('audienceIndividual')}</span>;
  }
  if (allNames.length === 0) {
    return <span className="text-xs text-muted-foreground">{t('audienceAll')}</span>;
  }
  const visible = allNames.slice(0, MAX_AUDIENCE_CHIPS);
  const overflow = allNames.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((name) => (
        <span
          key={name}
          className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
        >
          {name}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          +{overflow}
        </span>
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
