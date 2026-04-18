'use client';

import { useTranslations } from 'next-intl';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';

/**
 * Signed-in landing card. Renders "Hello {name}" from health.me via tRPC.
 * Phase 0 exit criterion #2.
 */
export function WelcomeCard() {
  const t = useTranslations('health');
  const tCommon = useTranslations('common');
  const { data, isLoading, isError } = trpc.health.me.useQuery();

  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST' });
    window.location.reload();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          {isLoading ? (
            <Skeleton className="h-5 w-40" />
          ) : isError || data === undefined ? (
            tCommon('error')
          ) : (
            t('welcome', { name: data.email })
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isLoading && data !== undefined && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('tenantLabel')}</dt>
            <dd className="font-mono text-xs">{data.tenantId}</dd>
          </dl>
        )}
        <Button variant="outline" className="w-full" onClick={signOut}>
          {t('signOut')}
        </Button>
      </CardContent>
    </Card>
  );
}
