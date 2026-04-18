'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../src/components/ui/card';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { trpc } from '../../../../src/lib/trpc/client';

/**
 * Permission sets overview. Phase 1 lists the tenant's sets with their
 * permission counts + user counts. Creating / editing a permission grid
 * happens through a modal in a follow-on iteration; the backend router
 * is complete, so this page is forward-compatible.
 */
export default function PermissionsPage() {
  const t = useTranslations('settings.permissions');
  const tCommon = useTranslations('common');
  const { data, isLoading } = trpc.permissions.list.useQuery();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(data ?? []).map((set) => (
            <Card key={set.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {set.name}
                  {set.isSystem ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                      {t('systemBadge')}
                    </span>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {set.description !== null ? (
                  <p className="text-muted-foreground">{set.description}</p>
                ) : null}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {set.permissions.length} {tCommon('name').toLowerCase()}
                  </span>
                  <span>{t('usersBadge', { count: set.userCount })}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
