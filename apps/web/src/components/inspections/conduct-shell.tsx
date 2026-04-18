'use client';

import type { Item, Page, Section } from '@forma360/shared/template-schema';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { trpc } from '../../lib/trpc/client';
import { useConduct } from './conduct-context';
import { findUnansweredRequired, isItemVisible, type Responses } from './conduct-state';
import { ResponseInput } from './response-input';

const AUTOSAVE_DEBOUNCE_MS = 1500;
const RETRY_INTERVAL_MS = 15_000;

function localStorageKey(inspectionId: string): string {
  return `forma360:conduct:pending:${inspectionId}`;
}

interface PendingPayload {
  responses: Responses;
  /** Server updatedAt at the time we queued this batch. Used to reconcile on reload. */
  basedOn: string;
  /** Local timestamp when the user last edited. */
  editedAt: number;
}

/**
 * Drives the conduct UI: renders pages, manages autosave + submit.
 *
 * The autosave path is intentionally resilient:
 *   - A debounced timer calls saveProgress 1.5s after the last keystroke.
 *   - On fetch failure (offline, 5xx) we persist the pending responses to
 *     localStorage under a per-inspection key and retry on a fixed
 *     interval + on the browser's `online` event.
 *   - On CONFLICT we surface the conflict dialog and stop autosaving.
 */
export function ConductShell() {
  const t = useTranslations('inspections.conduct');
  const tStatus = useTranslations('inspections.status');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();
  const { state, dispatch } = useConduct();
  const utils = trpc.useUtils();

  const [showConflict, setShowConflict] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

  const saveProgress = trpc.inspections.saveProgress.useMutation({
    onSuccess: (res) => {
      dispatch({ type: 'MARK_SAVED', updatedAt: res.updatedAt });
      clearPending(state.inspectionId);
    },
    onError: (err) => {
      if (err.data?.code === 'CONFLICT') {
        dispatch({ type: 'MARK_CONFLICT' });
        setShowConflict(true);
        return;
      }
      dispatch({ type: 'MARK_OFFLINE' });
      savePending(state.inspectionId, {
        responses: state.responses,
        basedOn: state.loadedUpdatedAt,
        editedAt: Date.now(),
      });
    },
  });

  const submit = trpc.inspections.submit.useMutation({
    onSuccess: () => {
      toast.success(t('submitSuccess'));
      void utils.inspections.get.invalidate({ inspectionId: state.inspectionId });
      void utils.inspections.list.invalidate();
      router.push(`/${locale}/inspections/${state.inspectionId}/status`);
    },
    onError: () => toast.error(t('submitError')),
  });

  const readonly = state.inspectionStatus !== 'in_progress';

  // Debounced autosave.
  const lastResponsesRef = useRef(state.responses);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (readonly) return;
      dispatch({ type: 'MARK_SAVING' });
      saveProgress.mutate({
        inspectionId: state.inspectionId,
        responses: state.responses,
        expectedUpdatedAt: state.loadedUpdatedAt,
      });
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [dispatch, readonly, saveProgress, state.inspectionId, state.loadedUpdatedAt, state.responses]);

  useEffect(() => {
    if (readonly) return;
    // Only fire autosave when responses actually changed (ref compare is
    // enough — SET_RESPONSE always produces a new object).
    if (lastResponsesRef.current === state.responses) return;
    lastResponsesRef.current = state.responses;
    scheduleSave();
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [readonly, scheduleSave, state.responses]);

  // Retry pending on mount + on `online`.
  useEffect(() => {
    const pending = loadPending(state.inspectionId);
    if (pending !== null) {
      // If the pending payload is newer than what we loaded from the
      // server, merge it into the reducer so the UI reflects the unsaved
      // edits and trigger a fresh save.
      if (pending.basedOn === state.loadedUpdatedAt) {
        dispatch({ type: 'MERGE_RESPONSES', responses: pending.responses });
        scheduleSave();
      } else {
        // Drift — surface a conflict rather than overwrite.
        dispatch({ type: 'MARK_CONFLICT' });
        setShowConflict(true);
      }
    }
    function onOnline() {
      const p = loadPending(state.inspectionId);
      if (p === null) return;
      scheduleSave();
    }
    const interval = setInterval(() => {
      const p = loadPending(state.inspectionId);
      if (p !== null && !saveProgress.isPending) scheduleSave();
    }, RETRY_INTERVAL_MS);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(interval);
    };
    // Deliberately only keyed on inspectionId: re-running this effect on
    // every responses edit would re-register the listeners on every
    // keystroke.
  }, [state.inspectionId, state.loadedUpdatedAt, saveProgress.isPending, dispatch, scheduleSave]);

  // Flush on unmount / tab close.
  useEffect(() => {
    function onBeforeUnload() {
      if (state.saveStatus.kind !== 'saved' && state.saveStatus.kind !== 'idle') {
        savePending(state.inspectionId, {
          responses: state.responses,
          basedOn: state.loadedUpdatedAt,
          editedAt: Date.now(),
        });
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [state.inspectionId, state.loadedUpdatedAt, state.responses, state.saveStatus.kind]);

  const currentPage = state.content.pages.find((p) => p.id === state.selectedPageId) ?? null;
  const pageIndex = state.content.pages.findIndex((p) => p.id === state.selectedPageId);
  const missing = useMemo(
    () => findUnansweredRequired(state.content, state.responses),
    [state.content, state.responses],
  );
  const canSubmit = missing.length === 0 && !readonly;

  function handleSubmit() {
    submit.mutate({ inspectionId: state.inspectionId });
    setShowSubmitConfirm(false);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <a href={`/${locale}/inspections`}>← {t('back')}</a>
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">{state.title}</h1>
              {state.documentNumber !== null ? (
                <p className="truncate text-xs text-muted-foreground">{state.documentNumber}</p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill status={state.inspectionStatus} tStatus={tStatus} />
            <SaveIndicator />
          </div>
        </div>
        <PageTabs />
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
          {currentPage === null ? null : (
            <PageBody
              page={currentPage}
              readonly={readonly}
            />
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const prev = state.content.pages[pageIndex - 1];
                if (prev !== undefined) dispatch({ type: 'SET_PAGE', pageId: prev.id });
              }}
              disabled={pageIndex <= 0}
            >
              {t('prevPage')}
            </Button>
            {pageIndex < state.content.pages.length - 1 ? (
              <Button
                size="sm"
                onClick={() => {
                  const next = state.content.pages[pageIndex + 1];
                  if (next !== undefined) dispatch({ type: 'SET_PAGE', pageId: next.id });
                }}
              >
                {t('nextPage')}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => setShowSubmitConfirm(true)}
                disabled={!canSubmit || submit.isPending}
                title={canSubmit ? undefined : t('missingRequired')}
              >
                {t('submitButton')}
              </Button>
            )}
          </div>

          {!canSubmit && !readonly ? (
            <p className="text-xs text-muted-foreground">{t('missingRequired')}</p>
          ) : null}
        </div>
      </main>

      <Dialog open={showConflict} onOpenChange={setShowConflict}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('conflictTitle')}</DialogTitle>
            <DialogDescription>{t('conflictBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => window.location.reload()}>{t('conflictReload')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSubmitConfirm} onOpenChange={setShowSubmitConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('submitConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('submitConfirmBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmitConfirm(false)}>
              {t('back')}
            </Button>
            <Button onClick={handleSubmit} disabled={submit.isPending}>
              {t('submitConfirmCta')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusPill({
  status,
  tStatus,
}: {
  status: string;
  tStatus: ReturnType<typeof useTranslations<'inspections.status'>>;
}) {
  const known = ['in_progress', 'awaiting_signatures', 'awaiting_approval', 'completed', 'rejected'];
  const key = known.includes(status) ? (status as 'in_progress') : 'in_progress';
  const colors: Record<string, string> = {
    in_progress: 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100',
    awaiting_signatures: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
    awaiting_approval: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
    completed: 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100',
    rejected: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100',
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${colors[key]}`}>
      {tStatus(key)}
    </span>
  );
}

function SaveIndicator() {
  const t = useTranslations('inspections.conduct');
  const { state } = useConduct();
  const s = state.saveStatus;
  if (s.kind === 'saving') return <span className="text-xs text-muted-foreground">{t('saving')}</span>;
  if (s.kind === 'saved') {
    const time = new Date(s.at).toLocaleTimeString();
    return <span className="text-xs text-muted-foreground">{t('savedAt', { time })}</span>;
  }
  if (s.kind === 'offline') return <span className="text-xs text-amber-700 dark:text-amber-400">{t('offline')}</span>;
  if (s.kind === 'conflict') return <span className="text-xs text-destructive">{t('conflictTitle')}</span>;
  return null;
}

function PageTabs() {
  const { state, dispatch } = useConduct();
  return (
    <nav className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4 pb-2" aria-label="pages">
      {state.content.pages.map((p, i) => {
        const active = p.id === state.selectedPageId;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => dispatch({ type: 'SET_PAGE', pageId: p.id })}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs transition-colors ${
              active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60'
            }`}
          >
            {i + 1}. {p.title}
          </button>
        );
      })}
    </nav>
  );
}

function PageBody({ page, readonly }: { page: Page; readonly: boolean }) {
  return (
    <div className="space-y-4">
      {page.description !== undefined ? (
        <p className="text-sm text-muted-foreground">{page.description}</p>
      ) : null}
      {page.sections.map((section) => (
        <SectionBody key={section.id} section={section} readonly={readonly} />
      ))}
    </div>
  );
}

function SectionBody({ section, readonly }: { section: Section; readonly: boolean }) {
  const { state } = useConduct();
  return (
    <Card className="space-y-3 p-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{section.title}</h2>
        {section.description !== undefined ? (
          <p className="text-sm text-muted-foreground">{section.description}</p>
        ) : null}
      </div>
      <ul className="space-y-4">
        {section.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            readonly={readonly}
            customResponseSets={state.content.customResponseSets}
          />
        ))}
      </ul>
    </Card>
  );
}

function ItemRow({
  item,
  readonly,
  customResponseSets,
}: {
  item: Item;
  readonly: boolean;
  customResponseSets: Parameters<typeof ResponseInput>[0]['responseSets'];
}) {
  const { state } = useConduct();
  const visible = isItemVisible(item, state.responses);
  if (!visible) return null;
  const prompt = 'prompt' in item ? item.prompt : null;
  const required = 'required' in item && item.required === true;
  return (
    <li className="space-y-2">
      {prompt !== null ? (
        <label className="text-sm font-medium" htmlFor={`item-${item.id}`}>
          {prompt}
          {required ? <span className="ml-1 text-destructive">*</span> : null}
        </label>
      ) : null}
      <div id={`item-${item.id}`}>
        <ResponseInput item={item} readonly={readonly} responseSets={customResponseSets} />
      </div>
      {'note' in item && item.note !== undefined ? (
        <p className="text-xs text-muted-foreground">{item.note}</p>
      ) : null}
    </li>
  );
}

// ─── localStorage helpers ───────────────────────────────────────────────────

function savePending(inspectionId: string, payload: PendingPayload) {
  try {
    window.localStorage.setItem(localStorageKey(inspectionId), JSON.stringify(payload));
  } catch {
    // Storage can throw in private modes / quota-exceeded — silently ignore.
  }
}

function loadPending(inspectionId: string): PendingPayload | null {
  try {
    const raw = window.localStorage.getItem(localStorageKey(inspectionId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as PendingPayload;
    if (typeof parsed.basedOn !== 'string' || typeof parsed.responses !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPending(inspectionId: string) {
  try {
    window.localStorage.removeItem(localStorageKey(inspectionId));
  } catch {
    // ignore
  }
}
