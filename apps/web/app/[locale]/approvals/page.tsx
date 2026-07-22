'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { SectionTabBar } from '../../../src/components/inspections/section-tab-bar';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { trpc } from '../../../src/lib/trpc/client';

function formatRelative(d: Date): string {
  const ms = Date.now() - new Date(d).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ApprovalsPage() {
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const t = useTranslations('approvals');
  const tInsp = useTranslations('inspections');
  const { data, isLoading } = trpc.inspections.list.useQuery({ status: 'awaiting_approval' });

  return (
    <div className="px-4 py-6">
      <SectionTabBar activeTab="approvals" locale={locale} />

      <div className="space-y-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('queueTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('queueSubtitle')}</p>
        </header>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
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
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/10">
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
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
