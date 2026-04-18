'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { trpc } from '../../../../src/lib/trpc/client';

export default function SitesPage() {
  const t = useTranslations('settings.sites');
  const tMode = useTranslations('settings.groups.mode');
  const { data, isLoading } = trpc.sites.list.useQuery();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">{t('table.name')}</th>
                <th className="px-3 py-2 font-medium">{t('table.depth')}</th>
                <th className="px-3 py-2 font-medium">{t('table.mode')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={3} className="p-4">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ) : (
                (data ?? []).map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <span style={{ paddingLeft: `${s.depth * 1.25}rem` }}>{s.name}</span>
                    </td>
                    <td className="px-3 py-2">{s.depth}</td>
                    <td className="px-3 py-2">
                      {s.membershipMode === 'rule_based' ? tMode('rule_based') : tMode('manual')}
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
