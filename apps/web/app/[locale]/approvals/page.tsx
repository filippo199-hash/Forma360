'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { trpc } from '../../../src/lib/trpc/client';

/**
 * Approvals queue. Lists every inspection in the tenant with status
 * `awaiting_approval`. The server-side `inspections.view` / `.manage`
 * checks remain authoritative; this UI only decides whether to offer
 * the row's approve/reject affordance on the detail page.
 *
 * Per-row allowed-approver filtering (via template.settings.approvalPage)
 * is deferred — the source of truth lives in the pinned template version
 * on the inspection, and that detail lands with the approval-slot work.
 */
export default function ApprovalsQueuePage() {
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const t = useTranslations('approvals');
  const tInsp = useTranslations('inspections');

  const { data, isLoading } = trpc.inspections.list.useQuery({ status: 'awaiting_approval' });

  return (
    <div className="space-y-6 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('queueTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('queueSubtitle')}</p>
      </header>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{tInsp('table.title')}</th>
                <th className="px-3 py-2 font-medium">{tInsp('table.documentNumber')}</th>
                <th className="px-3 py-2 font-medium">{t('submittedAt')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={3} className="p-4">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ) : (data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-8 text-center text-muted-foreground">
                    {t('empty')}
                  </td>
                </tr>
              ) : (
                (data ?? []).map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <Link
                        href={`/${locale}/approvals/${r.id}`}
                        className="font-medium hover:underline"
                      >
                        {r.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {r.documentNumber ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.submittedAt !== null ? formatRelative(r.submittedAt) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function formatRelative(d: Date): string {
  const ms = Date.now() - new Date(d).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
