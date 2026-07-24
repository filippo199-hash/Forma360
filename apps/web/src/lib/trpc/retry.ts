import type { AppRouter } from '@forma360/api';
import { isTRPCClientError } from '@trpc/client';

/**
 * React Query retry predicate for every tRPC query.
 *
 * A definitive client error (4xx — NOT_FOUND, FORBIDDEN, BAD_REQUEST, …) will
 * never succeed on retry, so we skip the retry entirely. That sends the query
 * straight to its error state, letting detail pages render "not found" /
 * "forbidden" immediately instead of sitting on a loading skeleton.
 *
 * Skipping the 4xx retry also avoids a nastier failure mode: with a retry
 * pending, React Query (networkMode 'online') pauses it whenever its
 * online-manager reports the browser offline — and if that state hiccups
 * mid-retry it can stay `fetchStatus: 'paused'` indefinitely, leaving the
 * page stuck on an infinite skeleton (observed on a real, online browser).
 *
 * Transient failures (5xx, network errors — which are not TRPCClientErrors, or
 * carry a 5xx httpStatus) are still worth one retry.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isTRPCClientError<AppRouter>(error)) {
    const status = error.data?.httpStatus;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return false;
    }
  }
  return failureCount < 1;
}
