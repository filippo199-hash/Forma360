'use client';

import {
  BadgeCheck,
  Bell,
  CheckCircle2,
  ClipboardCheck,
  FileSignature,
  GraduationCap,
  ListChecks,
  type LucideIcon,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Card, CardContent } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../../lib/cn';
import { trpc } from '../../lib/trpc/client';

/**
 * "My work" (ADR 0014) — the single queue of everything waiting on the
 * signed-in user, merged across modules and sorted by how late it is.
 *
 * The dashboard answers "how is the organisation doing" and needs
 * `analytics.view`; most people who open the product every morning do not
 * hold it and were landing on a menu of registers instead of a to-do
 * list. This page is the answer to "what do I do next", and it is the
 * default landing surface for every signed-in user.
 *
 * The navigation review turned the single "My work" menu entry into two
 * personal doors — *My actions* and *My acknowledgements* — because for
 * the majority of users those two rows are the whole product. They are
 * real routes rather than query strings so each can light up on its own
 * and be linked to directly; this component backs all three.
 */

type Kind = 'action' | 'acknowledgement' | 'signature' | 'inspection' | 'approval' | 'training';

const KIND_ICON: Record<Kind, LucideIcon> = {
  training: GraduationCap,
  action: ListChecks,
  acknowledgement: Bell,
  signature: FileSignature,
  inspection: ClipboardCheck,
  approval: BadgeCheck,
};

const FILTERS: readonly (Kind | 'all')[] = [
  'all',
  'action',
  'training',
  'acknowledgement',
  'signature',
  'inspection',
  'approval',
];

function SummaryTile({
  label,
  value,
  alert = false,
  loading,
}: {
  label: string;
  value: number;
  alert?: boolean;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        {loading ? (
          <Skeleton className="h-8 w-12" />
        ) : (
          <p
            className={cn(
              'text-3xl font-semibold tabular-nums tracking-tight',
              alert && value > 0 ? 'text-destructive' : undefined,
            )}
          >
            {value}
          </p>
        )}
        <p className="mt-1 text-sm font-medium">{label}</p>
      </CardContent>
    </Card>
  );
}

export function MyWorkQueue({
  initialFilter = 'all',
  titleKey = 'title',
  subtitleKey = 'subtitle',
}: {
  initialFilter?: Kind | 'all';
  /** `myWork.*` key for the heading — the personal doors name themselves. */
  titleKey?: string;
  subtitleKey?: string;
} = {}) {
  const t = useTranslations('myWork');
  const format = useFormatter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale;
  const [filter, setFilter] = useState<Kind | 'all'>(initialFilter);

  const counts = trpc.myWork.counts.useQuery();
  const list = trpc.myWork.list.useQuery(
    filter === 'all' ? { limit: 100 } : { limit: 100, kinds: [filter] },
  );

  const rows = list.data?.rows ?? [];
  const c = counts.data;

  const fmt = (date: Date): string =>
    format.dateTime(new Date(date), { day: 'numeric', month: 'short' });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t(titleKey as never)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(subtitleKey as never)}</p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile
          label={t('tiles.overdue')}
          value={c?.myOverdueActions ?? 0}
          alert
          loading={counts.isPending}
        />
        <SummaryTile
          label={t('tiles.actions')}
          value={c?.myOpenActions ?? 0}
          loading={counts.isPending}
        />
        <SummaryTile
          label={t('tiles.acknowledgements')}
          value={c?.myPendingAcks ?? 0}
          loading={counts.isPending}
        />
        <SummaryTile
          label={t('tiles.drafts')}
          value={c?.myDraftInspections ?? 0}
          loading={counts.isPending}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label={t('filterLabel')}>
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              filter === key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {t(`kinds.${key}`)}
          </button>
        ))}
      </div>

      {list.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">{t('empty.title')}</p>
            <p className="text-sm text-muted-foreground">{t('empty.body')}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((row) => {
            const Icon = KIND_ICON[row.kind];
            return (
              <li key={`${row.kind}-${row.id}`}>
                <Link
                  href={`/${locale}${row.href}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{row.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`kinds.${row.kind}`)}
                    </span>
                  </span>
                  {row.dueAt !== null ? (
                    <span
                      className={cn(
                        'shrink-0 text-xs tabular-nums',
                        row.overdue ? 'font-semibold text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {row.overdue ? t('overdueOn', { date: fmt(row.dueAt) }) : fmt(row.dueAt)}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
