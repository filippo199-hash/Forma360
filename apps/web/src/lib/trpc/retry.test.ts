import type { AppRouter } from '@forma360/api';
import { TRPCClientError } from '@trpc/client';
import { describe, expect, it } from 'vitest';
import { shouldRetryQuery } from './retry';

/** Build a real TRPCClientError carrying a given httpStatus in its `data`. */
function trpcError(httpStatus: number): TRPCClientError<AppRouter> {
  return TRPCClientError.from<AppRouter>({
    error: {
      code: -32004,
      message: 'err',
      data: { httpStatus, code: 'NOT_FOUND', path: 'inspections.get' },
    },
  });
}

describe('shouldRetryQuery', () => {
  it('never retries definitive 4xx client errors', () => {
    for (const status of [400, 401, 403, 404, 409]) {
      expect(shouldRetryQuery(0, trpcError(status))).toBe(false);
    }
  });

  it('retries a transient 5xx once, then stops', () => {
    expect(shouldRetryQuery(0, trpcError(500))).toBe(true);
    expect(shouldRetryQuery(0, trpcError(503))).toBe(true);
    expect(shouldRetryQuery(1, trpcError(500))).toBe(false);
  });

  it('retries a non-tRPC (network) error once, then stops', () => {
    const networkError = new Error('Failed to fetch');
    expect(shouldRetryQuery(0, networkError)).toBe(true);
    expect(shouldRetryQuery(1, networkError)).toBe(false);
  });
});
