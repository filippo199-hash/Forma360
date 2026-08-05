'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { SectionTabBar } from '../../../src/components/inspections/section-tab-bar';
import { Card, CardContent } from '../../../src/components/ui/card';
import { Skeleton } from '../../../src/components/ui/skeleton';
import { trpc } from '../../../src/lib/trpc/client';

/**
 * Locale-aware relative time (e.g. "5 minutes ago", "just now"). Picks the
 * largest sensible unit and defers wording + pluralisation to the runtime's
 * Intl.RelativeTimeFormat — no i18n key needed.
 */
function relativeTime(date: Date, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return rtf.format(-seconds, 'second');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.floor(hours / 24), 'day');
}

export default function ApprovalsPage() {
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const t = useTranslations('approvals');
  const tInsp = useTranslations('inspections');
  const { data, isLoading } = trpc.inspections.list.useQuery({ status: 'awaiting_approval' });

  return (
    <div>
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
                    <th className="px-3 py-2 font-medium">{t('submitter')}</th>
                    <th className="px-3 py-2 font-medium">{t('site')}</th>
                    <th className="px-3 py-2 font-medium">{t('submittedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="p-4">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ) : (data ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground">
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
                          {r.conductedByName ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{r.siteName ?? '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {r.submittedAt !== null ? relativeTime(r.submittedAt, locale) : '—'}
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
