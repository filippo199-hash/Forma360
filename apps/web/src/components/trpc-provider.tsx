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
 */
export function TRPCProvider({ children }: { children: ReactNode }) {
  const tErrors = useTranslations('serverErrors');
  const tCommon = useTranslations('common');

  const [queryClient] = useState(
    () =>
      new QueryClient({
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
        }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: shouldRetryQuery,
          },
        },
      }),
  );

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
