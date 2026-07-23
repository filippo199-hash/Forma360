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

const STATUS_OPTIONS: ReadonlyArray<StatusFilter> = ['all', 'draft', 'published', 'archived'];

export default function HeadsUpListPage() {
  const t = useTranslations('headsUp.list');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canPublish = useHasPermission('headsUp.publish');

  const [status, setStatus] = useState<StatusFilter>('all');

  const { data, isLoading } = trpc.headsUps.list.useQuery({
    status: status === 'all' ? undefined : status,
  });

  const rows = data ?? [];

  return (
    <div className="space-y-4 sm:space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">{t('subtitle')}</p>
        </div>
        {canPublish ? (
          <Button asChild>
            <Link href={`/${locale}/heads-up/new`}>
              <Plus className="mr-1 h-4 w-4" />
              {t('newButton')}
            </Link>
          </Button>
        ) : null}
      </header>

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
        <Card>
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
                      <td className="px-3 py-2 text-muted-foreground">{row.creatorName ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {new Date(row.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
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
