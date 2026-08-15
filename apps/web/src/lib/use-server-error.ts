'use client';

/**
 * The one-line way for a mutation to tell the truth about why it failed.
 *
 * Before this, the house pattern was
 *
 *     const onError = () => toast.error(t('saveError'));
 *
 * repeated at 105 call sites, each one discarding a precise server reason in
 * favour of "Could not save. Try again." `useServerErrorToast` keeps the same
 * shape — so adopting it is a one-line change — but resolves the guard key
 * first and only falls back to the generic string when there is genuinely
 * nothing better to say.
 *
 *     const onError = useServerErrorToast(t('saveError'));
 *     const m = trpc.x.y.useMutation({ onSuccess, onError });
 *
 * Pass the call site's EXISTING generic copy as the fallback. That way the
 * worst case is exactly what shipped before, and the common case is the
 * sentence the server already wrote.
 */
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { serverErrorMessage } from './server-error';

/**
 * @param fallback generic copy for when the server sends no recognisable key
 * @returns an `onError` handler suitable for any tRPC mutation
 */
export function useServerErrorToast(fallback: string): (err: unknown) => void {
  const t = useTranslations('serverErrors');
  return useCallback(
    (err: unknown) => {
      toast.error(serverErrorMessage(err, t as (k: string) => string, fallback));
    },
    [t, fallback],
  );
}

/**
 * The same resolution without the toast, for forms that show the message
 * inline next to the field rather than in the corner of the screen.
 */
export function useServerErrorMessage(): (err: unknown, fallback: string) => string {
  const t = useTranslations('serverErrors');
  return useCallback(
    (err: unknown, fallback: string) =>
      serverErrorMessage(err, t as (k: string) => string, fallback),
    [t],
  );
}
