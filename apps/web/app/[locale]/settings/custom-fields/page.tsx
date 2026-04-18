'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { trpc } from '../../../../src/lib/trpc/client';

/**
 * Custom user fields listing. Create/edit/delete dialogs are scaffolded
 * against the existing `customFields` router — the hard parts (S-E04
 * reference-count guard + the deletion modal) live server-side. This
 * page renders the list and leaves the create/edit UI to a follow-on
 * iteration.
 */
export default function CustomFieldsPage() {
  const t = useTranslations('settings');
  const { data, isLoading } = trpc.customFields.list.useQuery();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('nav.customFields')}</h1>
      </header>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">{t('groups.table.name')}</th>
                <th className="px-3 py-2 font-medium">{t('groups.table.mode')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={2} className="p-4">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ) : (
                (data ?? []).map((f) => (
                  <tr key={f.id} className="border-b last:border-0">
                    <td className="px-3 py-2">{f.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{f.type}</td>
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
