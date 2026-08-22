'use client';

/**
 * App-styled replacement for `window.prompt` (UXW3-01 — the NR3-05 class).
 *
 * A native prompt() shares every defect of the native confirm the app
 * already banned — main-thread block, unstylable, untranslatable chrome —
 * and one worse: kiosk browsers, WebViews and automation contexts
 * suppress it entirely, returning null with no UI, so the control that
 * opened it reads as dead. The permit external-acceptance signature (a
 * legal record) was captured through one; it now goes through this.
 *
 * Usage (1:1 swap for `const v = window.prompt(msg)`):
 *
 *     const v = await appPrompt({ title, label });   // null = cancelled
 *
 * `AppPromptProvider` renders the singleton dialog beside
 * `AppConfirmProvider` in the signed-in shell. If the provider is not
 * mounted (isolated tests), `appPrompt` falls back to the native prompt
 * rather than fabricating an answer.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Input } from './input';
import { Textarea } from './textarea';

export interface PromptOptions {
  /** Dialog heading — a signature or reason dialog must name itself. */
  title: string;
  /** Context above the field: who is signing what, why the reason is asked. */
  description?: string;
  /** Label for the input. */
  label: string;
  placeholder?: string;
  initialValue?: string;
  /** Primary button label. Defaults to the localised "Confirm". */
  confirmLabel?: string;
  /** Minimum trimmed length before the primary button enables. Default 1. */
  minLength?: number;
  /** Render a textarea (reasons) instead of a single-line input (names). */
  multiline?: boolean;
}

interface PromptRequest extends PromptOptions {
  resolve: (value: string | null) => void;
}

let enqueue: ((request: PromptRequest) => void) | null = null;

export function appPrompt(options: PromptOptions): Promise<string | null> {
  if (enqueue === null) {
    // Provider absent (unit test, public route). Fall back to the native
    // dialog so the action still requires a human answer; suppressed
    // contexts return null, which is the cancel semantic.
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
      const raw = window.prompt(options.description ?? options.title, options.initialValue ?? '');
      const trimmed = raw?.trim() ?? '';
      return Promise.resolve(
        raw === null || trimmed.length < (options.minLength ?? 1) ? null : trimmed,
      );
    }
    return Promise.resolve(null);
  }
  return new Promise<string | null>((resolve) => {
    enqueue?.({ ...options, resolve });
  });
}

export function AppPromptProvider() {
  const t = useTranslations('common');
  const [request, setRequest] = useState<PromptRequest | null>(null);
  const [value, setValue] = useState('');
  // The resolve of the OPEN request, so a queued replacement can settle it
  // as cancelled (never an implicit answer) without racing state updates.
  const openRequest = useRef<PromptRequest | null>(null);

  useEffect(() => {
    enqueue = (next) => {
      openRequest.current?.resolve(null);
      openRequest.current = next;
      setValue(next.initialValue ?? '');
      setRequest(next);
    };
    return () => {
      enqueue = null;
    };
  }, []);

  const settle = (submitted: boolean): void => {
    const trimmed = value.trim();
    request?.resolve(submitted && trimmed.length >= (request.minLength ?? 1) ? trimmed : null);
    openRequest.current = null;
    setRequest(null);
    setValue('');
  };

  const ready = value.trim().length >= (request?.minLength ?? 1);

  return (
    <Dialog open={request !== null} onOpenChange={(open) => (!open ? settle(false) : undefined)}>
      <DialogContent className="max-w-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) settle(true);
          }}
        >
          <DialogHeader>
            <DialogTitle>{request?.title ?? ''}</DialogTitle>
            {request?.description !== undefined ? (
              <DialogDescription>{request.description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <div className="space-y-1.5 py-3">
            <label className="text-sm font-medium" htmlFor="app-prompt-field">
              {request?.label ?? ''}
            </label>
            {request?.multiline === true ? (
              <Textarea
                id="app-prompt-field"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={request?.placeholder}
                rows={3}
                autoFocus
              />
            ) : (
              <Input
                id="app-prompt-field"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={request?.placeholder}
                autoFocus
              />
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => settle(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!ready}>
              {request?.confirmLabel ?? t('confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
