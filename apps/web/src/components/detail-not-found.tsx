'use client';

import type { AppRouter } from '@forma360/api';
import type { TRPCClientErrorLike } from '@trpc/client';
import { useTranslations } from 'next-intl';

/**
 * Standard not-found / error state for a detail page whose primary query
 * failed. Render this INSIDE the loading gate when `error` is set, e.g.
 *
 *   if (isLoading || data === undefined) {
 *     if (error) return <DetailNotFound error={error} />;
 *     return <Skeleton …/>;
 *   }
 *
 * The error check must live inside the gate (or above it): on error `data`
 * is undefined, so a bare `isLoading || !data` skeleton would sit forever
 * once the query has settled. Distinguishes NOT_FOUND from a generic error.
 */
export function DetailNotFound({ error }: { error: TRPCClientErrorLike<AppRouter> }) {
  const tCommon = useTranslations('common');
  return (
    <p role="alert" className="text-sm text-destructive">
      {error.data?.code === 'NOT_FOUND' ? tCommon('notFound') : tCommon('error')}
    </p>
  );
}
