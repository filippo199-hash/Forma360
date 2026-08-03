'use client';

/**
 * Tenant-wide audit feed (platform HSE review PF-31). Merges every
 * module's append-only event table into one reverse-chronological stream,
 * gated by `org.audit.view` — the key existed since Phase 1 with nothing
 * consuming it.
 */
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Button } from '../../../../src/components/ui/button';
import { trpc } from '../../../../src/lib/trpc/client';

const MODULES = [
  'all',
  'actions',
  'observations',
  'permits',
  'coshh',
  'riskAssessments',
  'fireSafety',
  'contractors',
] as const;
type ModuleFilter = (typeof MODULES)[number];

export default function AuditLogPage() {
  const t = useTranslations('settings.audit');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const [module, setModule] = useState<ModuleFilter>('all');
  const [before, setBefore] = useState<string | undefined>(undefined);
  const [older, setOlder] = useState<
    Array<{
      module: string;
      entityId: string;
      kind: string;
      detail: string;
      actorName: string | null;
      createdAt: Date;
    }>
  >([]);

  const feed = trpc.admin.auditLog.useQuery({
    limit: 50,
    module,
    ...(before !== undefined ? { before } : {}),
  });

  const rows = [...older, ...(feed.data?.rows ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  function loadMore() {
    const last = rows[rows.length - 1];
    if (last === undefined) return;
    setOlder(rows);
    setBefore(new Date(last.createdAt).toISOString());
  }

  function switchModule(next: ModuleFilter) {
    setModule(next);
    setBefore(undefined);
    setOlder([]);
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {MODULES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchModule(m)}
            className={
              module === m
                ? 'rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'
                : 'rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted'
            }
          >
            {t(`modules.${m}` as never)}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {feed.isLoading && rows.length === 0 ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('columns.when')}</th>
                    <th className="px-3 py-2 font-medium">{t('columns.module')}</th>
                    <th className="px-3 py-2 font-medium">{t('columns.event')}</th>
                    <th className="px-3 py-2 font-medium">{t('columns.actor')}</th>
                    <th className="px-3 py-2 font-medium">{t('columns.detail')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.module}-${r.entityId}-${i}`} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {new Date(r.createdAt).toLocaleString(locale)}
                      </td>
                      <td className="px-3 py-2">{t(`modules.${r.module}` as never)}</td>
                      <td className="px-3 py-2 font-medium">{r.kind.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-2">{r.actorName ?? t('systemActor')}</td>
                      <td className="max-w-md truncate px-3 py-2 text-muted-foreground">
                        {r.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {feed.data?.hasMore === true ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={feed.isFetching}>
            {t('loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
