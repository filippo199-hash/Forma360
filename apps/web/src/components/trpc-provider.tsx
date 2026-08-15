'use client';

import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';
import superjson from 'superjson';
import { trpc } from '../lib/trpc/client';
import { shouldRetryQuery } from '../lib/trpc/retry';
import { serverErrorMessage } from '../lib/server-error';

/**
 * Wraps every client component in the TanStack Query + tRPC React contexts.
 * Mounted once in the locale layout so pages can `trpc.health.me.useQuery()`
 * without extra boilerplate.
 *
 * The MutationCache default is the safety net for server refusals. Domain
 * guards throw stable kebab-case keys (`gas-test-stale`,
 * `lev-failed-examination-outstanding`) that carry the real reason; a mutation
 * that sets no `onError` of its own used to fail silently. Now it surfaces the
 * sentence the guard actually meant. A mutation WITH its own handler still
 * wins — those call sites use `useServerErrorToast`, which resolves the same
 * catalogue.
 *
 * BUG-02: it is also the safety net for STALE READS AFTER A WRITE. Queries
 * are cached for 30 seconds, so anything a mutation changed stays wrong for
 * up to half a minute unless that call site remembered to invalidate it. The
 * COSHH assessment page is the case that shipped: it resolves its record out
 * of `substances.get`, the substance page had already cached that query, and
 * a brand-new assessment therefore opened on a copy taken before it existed —
 * so the product told four separate practitioners that the record they had
 * just saved could not be found. Reloading fixed it, which is the signature
 * of a stale cache and reads to a user as data loss.
 *
 * Relying on every call site to list its own invalidations is how that
 * happened, and there are hundreds of them. Invalidating on success by
 * default inverts it: forgetting now costs a refetch instead of showing
 * wrong data. Call sites that invalidate specific queries still work — this
 * runs alongside them, not instead.
 */
export function TRPCProvider({ children }: { children: ReactNode }) {
  const tErrors = useTranslations('serverErrors');
  const tCommon = useTranslations('common');

  const [queryClient] = useState(() => {
    const client: QueryClient = new QueryClient({
      mutationCache: new MutationCache({
        onError: (error, _vars, _ctx, mutation) => {
          // Respect a call site that handles its own errors.
          if (mutation.options.onError !== undefined) return;
          const copy = serverErrorMessage(
            error,
            tErrors as (k: string) => string,
            tCommon('error'),
          );
          toast.error(copy);
        },
        // Anything a write touched is suspect until it is read again. Only
        // ACTIVE queries refetch immediately; everything else is marked
        // stale and refetches when something mounts it, so this costs one
        // round trip for what is on screen rather than a storm.
        onSuccess: () => {
          void client.invalidateQueries();
        },
      }),
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          refetchOnWindowFocus: false,
          retry: shouldRetryQuery,
        },
      },
    });
    return client;
  });

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: '/api/trpc',
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
