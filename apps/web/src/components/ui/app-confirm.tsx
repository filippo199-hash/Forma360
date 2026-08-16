'use client';

/**
 * App-styled replacement for `window.confirm` (NR3-05).
 *
 * A native confirm() is a hard block on the browser's main thread: it
 * freezes rendering, it cannot be styled or translated consistently, it
 * is invisible to assistive tech theming, and on one tester's machine it
 * wedged the page entirely — the risk-assessment hazard delete "froze
 * the page (recovered only on reload)". Every destructive flow that used
 * it now goes through `appConfirm()`, which resolves a promise from a
 * proper dialog.
 *
 * Usage at a call site (1:1 swap for `if (window.confirm(msg))`):
 *
 *     if (await appConfirm({ description: msg, destructive: true })) { … }
 *
 * `AppConfirmProvider` renders the singleton dialog and is mounted once
 * in the signed-in shell. If the provider is not mounted (isolated
 * tests), `appConfirm` falls back to the native dialog rather than
 * silently approving or refusing.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';

export interface ConfirmOptions {
  /** Dialog heading. Defaults to the localised "Are you sure?". */
  title?: string;
  /** The question itself — what happens if they confirm. */
  description: string;
  /** Primary button label. Defaults to the localised "Confirm". */
  confirmLabel?: string;
  /** Style the primary button as destructive (red). */
  destructive?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

let enqueue: ((request: ConfirmRequest) => void) | null = null;

export function appConfirm(options: ConfirmOptions | string): Promise<boolean> {
  const opts: ConfirmOptions = typeof options === 'string' ? { description: options } : options;
  if (enqueue === null) {
    // Provider absent (unit test, public route). Fall back to the native
    // dialog so the action still requires a human decision.
    return Promise.resolve(
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(opts.description)
        : false,
    );
  }
  return new Promise<boolean>((resolve) => {
    enqueue?.({ ...opts, resolve });
  });
}

export function AppConfirmProvider() {
  const t = useTranslations('common');
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    enqueue = (next) => {
      setRequest((previous) => {
        // A second confirm while one is open cancels the first — same
        // as the user dismissing it, never an implicit approval.
        previous?.resolve(false);
        return next;
      });
    };
    return () => {
      enqueue = null;
    };
  }, []);

  const settle = (confirmed: boolean): void => {
    request?.resolve(confirmed);
    setRequest(null);
  };

  return (
    <Dialog open={request !== null} onOpenChange={(open) => (!open ? settle(false) : undefined)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{request?.title ?? t('confirmTitle')}</DialogTitle>
          <DialogDescription>{request?.description ?? ''}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => settle(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant={request?.destructive === true ? 'destructive' : 'default'}
            onClick={() => settle(true)}
          >
            {request?.confirmLabel ?? t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
