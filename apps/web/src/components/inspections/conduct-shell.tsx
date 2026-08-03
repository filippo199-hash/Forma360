'use client';

import type { ActionCustomQuestion } from '@forma360/shared/actions-schema';
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
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Sheet, SheetContent } from '../ui/sheet';
import { Skeleton } from '../ui/skeleton';
import { Textarea } from '../ui/textarea';
import { cn } from '../../lib/cn';
import { trpc } from '../../lib/trpc/client';
import { ActionDetailPanel } from '../actions/action-detail-panel';
import { useConduct } from './conduct-context';
import { missingEvidence, requiredEvidenceCount } from '@forma360/shared/inspection-eval';
import {
  findInvalidNumbers,
  findUnansweredRequired,
  isItemRevealed,
  itemLocations,
  skippedPages,
  type Responses,
} from './conduct-state';
import { EvidenceUploader } from './evidence-uploader';
import { ResponseInput } from './response-input';

const AUTOSAVE_DEBOUNCE_MS = 1500;
const RETRY_INTERVAL_MS = 15_000;

/** Stable empty set so readonly inspections don't churn the PageTabs props. */
const EMPTY_PAGE_SET: ReadonlySet<string> = new Set<string>();

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

const KNOWN_STATUSES = [
  'in_progress',
  'awaiting_signatures',
  'awaiting_approval',
  'completed',
  'rejected',
] as const;
type KnownStatus = (typeof KNOWN_STATUSES)[number];

function toKnownStatus(status: string): KnownStatus {
  return (KNOWN_STATUSES as readonly string[]).includes(status)
    ? (status as KnownStatus)
    : 'in_progress';
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

  /** The action currently open in the detail sidebar. */
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);

  // For in-progress inspections we exclude archived actions so that a user
  // who archives a mistakenly-raised action sees it disappear from the conduct
  // view immediately. For any other status the inspection is effectively
  // read-only/historic and we include archived actions to preserve the audit
  // trail (a completed inspection must always show every action that was ever
  // raised, even if those actions were later archived on the main board).
  const inspectionIsInProgress = state.inspectionStatus === 'in_progress';

  // Pre-load actions already raised for this inspection.
  // When an action is archived via the detail sidebar, ActionDetailPanel
  // calls utils.actions.list.invalidate() which causes this query to refetch.
  // For in-progress inspections the re-fetch excludes the archived action, so
  // it naturally disappears from actionRaisedMap below.
  const { data: existingActions } = trpc.actions.list.useQuery({
    sourceType: 'inspection',
    sourceId: state.inspectionId,
    assignedToMe: false,
    overdueOnly: false,
    includeArchived: !inspectionIsInProgress,
    hideClosed: false,
    sortBy: 'created',
  });

  /**
   * Optimistic additions: question IDs raised in this session before the DB
   * query has had a chance to refetch and include the new action. Kept small
   * and separate so that DB truth (below) can override / remove entries.
   */
  const [sessionRaisedMap, setSessionRaisedMap] = useState<Map<string, string>>(() => new Map());

  /**
   * The authoritative map used for rendering: DB truth takes precedence.
   * When existingActions has loaded, entries absent from it (e.g. archived
   * actions on an in-progress inspection) simply won't appear. Session
   * additions fill the brief window between a create mutation and the next
   * refetch.
   */
  const actionRaisedMap = useMemo(() => {
    const m = new Map<string, string>();
    if (existingActions !== undefined) {
      for (const a of existingActions.rows) {
        if (a.sourceItemId !== null) m.set(a.sourceItemId, a.id);
      }
    }
    // Session-raised entries only appear if not yet reflected in the DB data.
    for (const [k, v] of sessionRaisedMap) {
      if (!m.has(k)) m.set(k, v);
    }
    return m;
  }, [existingActions, sessionRaisedMap]);

  const handleActionRaised = useCallback((questionId: string, actionId: string) => {
    setSessionRaisedMap((prev) => new Map([...prev, [questionId, actionId]]));
  }, []);

  const saveProgress = trpc.inspections.saveProgress.useMutation({
    onSuccess: (res) => {
      dispatch({ type: 'MARK_SAVED', updatedAt: res.updatedAt });
      clearPending(state.inspectionId);
    },
    onError: (err) => {
      if (err.data?.code === 'CONFLICT') {
        // Persist the in-memory answers so "Reload & keep my answers" can
        // re-apply them onto the fresh server version after reload — a bare
        // reload would otherwise discard everything typed since the last save.
        savePending(state.inspectionId, {
          responses: state.responses,
          basedOn: state.loadedUpdatedAt,
          editedAt: Date.now(),
        });
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
    onSuccess: (res) => {
      toast.success(t('submitSuccess'));
      void utils.inspections.get.invalidate({ inspectionId: state.inspectionId });
      void utils.inspections.list.invalidate();
      // When the inspection is fully completed, land straight on the full
      // report. Otherwise (awaiting signatures/approval) show the status page.
      const dest =
        res.status === 'completed'
          ? `/${locale}/inspections/${state.inspectionId}/report`
          : `/${locale}/inspections/${state.inspectionId}/status`;
      router.push(dest);
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
  }, [
    dispatch,
    readonly,
    saveProgress,
    state.inspectionId,
    state.loadedUpdatedAt,
    state.responses,
  ]);

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
      // Re-apply the user's pending answers on top of whatever we just loaded
      // from the server, then save with the fresh `expectedUpdatedAt`. This
      // covers BOTH the offline-recovery case (same base) and the conflict
      // "Reload & keep my answers" case (server advanced under us) — in both
      // we must not lose typed work. Merge is last-writer-wins per field;
      // inspections are single-conductor so this is safe. "Discard changes"
      // clears the pending payload before reload, so nothing is merged.
      dispatch({ type: 'MERGE_RESPONSES', responses: pending.responses });
      scheduleSave();
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
  // Pages fully skipped by an active forward jump are stepped over in nav.
  const skippedPageIds = useMemo(
    () => skippedPages(state.content, state.responses),
    [state.content, state.responses],
  );
  const nextPageId = ((): string | null => {
    for (let i = pageIndex + 1; i < state.content.pages.length; i++) {
      const p = state.content.pages[i];
      if (p !== undefined && !skippedPageIds.has(p.id)) return p.id;
    }
    return null;
  })();
  const prevPageId = ((): string | null => {
    for (let i = pageIndex - 1; i >= 0; i--) {
      const p = state.content.pages[i];
      if (p !== undefined && !skippedPageIds.has(p.id)) return p.id;
    }
    return null;
  })();
  const isLastPage = nextPageId === null;
  const missing = useMemo(
    () => findUnansweredRequired(state.content, state.responses),
    [state.content, state.responses],
  );
  const evidenceMissing = useMemo(
    () => missingEvidence(state.content, state.responses),
    [state.content, state.responses],
  );
  const invalidNumbers = useMemo(
    () => findInvalidNumbers(state.content, state.responses),
    [state.content, state.responses],
  );
  const canSubmit =
    missing.length === 0 &&
    evidenceMissing.length === 0 &&
    invalidNumbers.length === 0 &&
    !readonly;

  // Everything blocking submit, with its page + prompt, so the inspector can
  // jump straight to each one instead of hunting page-by-page.
  const locations = useMemo(() => itemLocations(state.content), [state.content]);
  const blocking = useMemo(() => {
    const seen = new Set<string>();
    const out: {
      id: string;
      pageId: string;
      pageIndex: number;
      prompt: string | null;
      reason: 'answer' | 'evidence' | 'range';
    }[] = [];
    const add = (id: string, reason: 'answer' | 'evidence' | 'range') => {
      const key = `${id}:${reason}`;
      if (seen.has(key)) return;
      seen.add(key);
      const loc = locations.get(id);
      if (loc !== undefined) out.push({ id, ...loc, reason });
    };
    missing.forEach((id) => add(id, 'answer'));
    invalidNumbers.forEach((id) => add(id, 'range'));
    evidenceMissing.forEach((e) => add(e.itemId, 'evidence'));
    return out.sort((a, b) => a.pageIndex - b.pageIndex);
  }, [missing, invalidNumbers, evidenceMissing, locations]);
  const blockingPageIds = useMemo(() => new Set(blocking.map((b) => b.pageId)), [blocking]);

  const jumpTo = useCallback(
    (pageId: string, itemId: string) => {
      dispatch({ type: 'SET_PAGE', pageId });
      // Let the new page render, then bring the question into view.
      setTimeout(() => {
        document
          .getElementById(`item-${itemId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
    },
    [dispatch],
  );

  function handleSubmit() {
    submit.mutate({ inspectionId: state.inspectionId });
    setShowSubmitConfirm(false);
  }

  const safeStatus = toKnownStatus(state.inspectionStatus);

  return (
    // fixed inset-0 overlays the global sidebar (same technique as the
    // template EditorShell at z-50 and FocusedPageShell at z-40).
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b bg-background/95 backdrop-blur">
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
        <PageTabs blockingPageIds={readonly ? EMPTY_PAGE_SET : blockingPageIds} />
      </header>

      {/* ── Scrollable content ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* Readonly notice — shown once the inspection has been submitted */}
        {readonly ? (
          <div className="border-b bg-amber-50 dark:bg-amber-950/30">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2.5">
              <p className="text-sm text-amber-800 dark:text-amber-300">
                {t('readonly', { status: tStatus(safeStatus) })}
              </p>
              <Button variant="outline" size="sm" asChild>
                <a href={`/${locale}/inspections/${state.inspectionId}/status`}>
                  {t('goToStatus')}
                </a>
              </Button>
            </div>
          </div>
        ) : null}

        <main>
          <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
            {currentPage === null ? null : (
              <PageBody
                page={currentPage}
                readonly={readonly}
                actionRaisedMap={actionRaisedMap}
                onActionRaised={handleActionRaised}
                onOpenAction={setSelectedActionId}
              />
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (prevPageId !== null) dispatch({ type: 'SET_PAGE', pageId: prevPageId });
                }}
                disabled={prevPageId === null}
              >
                {t('prevPage')}
              </Button>

              {!isLastPage ? (
                <Button
                  size="sm"
                  onClick={() => {
                    if (nextPageId !== null) dispatch({ type: 'SET_PAGE', pageId: nextPageId });
                  }}
                >
                  {t('nextPage')}
                </Button>
              ) : readonly ? (
                /* Inspection already submitted — guide user to the status/signing page */
                <Button size="sm" variant="outline" asChild>
                  <a href={`/${locale}/inspections/${state.inspectionId}/status`}>
                    {t('goToStatus')}
                  </a>
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

            {blocking.length > 0 && !readonly ? (
              <div className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                  {t('submitBlockedHeading', { count: blocking.length })}
                </p>
                <ul className="space-y-0.5">
                  {blocking.slice(0, 12).map((b) => (
                    <li key={`${b.id}:${b.reason}`}>
                      <button
                        type="button"
                        onClick={() => jumpTo(b.pageId, b.id)}
                        className="text-left text-xs text-amber-800 underline-offset-2 hover:underline dark:text-amber-300"
                      >
                        {b.pageIndex + 1}. {b.prompt ?? t('untitledQuestion')} —{' '}
                        {t(`blockReason.${b.reason}`)}
                      </button>
                    </li>
                  ))}
                  {blocking.length > 12 ? (
                    <li className="text-xs text-amber-700 dark:text-amber-400">
                      {t('andMoreBlocking', { count: blocking.length - 12 })}
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </div>
        </main>
      </div>

      {/* ── Action detail sidebar ────────────────────────────────────── */}
      <Sheet
        open={selectedActionId !== null}
        onOpenChange={(o) => {
          if (!o) setSelectedActionId(null);
        }}
      >
        <SheetContent className="w-full p-0 sm:max-w-2xl" side="right">
          {selectedActionId !== null ? (
            <ActionDetailPanel actionId={selectedActionId} locale={locale} />
          ) : null}
        </SheetContent>
      </Sheet>

      {/* ── Dialogs (portals — position in tree is irrelevant) ────────── */}
      <Dialog open={showConflict} onOpenChange={setShowConflict}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('conflictTitle')}</DialogTitle>
            <DialogDescription>{t('conflictBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                // Throw away the local edits and reload the server version.
                clearPending(state.inspectionId);
                window.location.reload();
              }}
            >
              {t('conflictDiscard')}
            </Button>
            {/* Answers were persisted on conflict; reload re-applies them. */}
            <Button onClick={() => window.location.reload()}>{t('conflictKeep')}</Button>
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
  const key = toKnownStatus(status);
  const colors: Record<KnownStatus, string> = {
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
  if (s.kind === 'saving')
    return <span className="text-xs text-muted-foreground">{t('saving')}</span>;
  if (s.kind === 'saved') {
    const time = new Date(s.at).toLocaleTimeString();
    return <span className="text-xs text-muted-foreground">{t('savedAt', { time })}</span>;
  }
  if (s.kind === 'offline')
    return <span className="text-xs text-amber-700 dark:text-amber-400">{t('offline')}</span>;
  if (s.kind === 'conflict')
    return <span className="text-xs text-destructive">{t('conflictTitle')}</span>;
  return null;
}

function PageTabs({ blockingPageIds }: { blockingPageIds: ReadonlySet<string> }) {
  const t = useTranslations('inspections.conduct');
  const { state, dispatch } = useConduct();
  const skipped = skippedPages(state.content, state.responses);
  return (
    <nav className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4 pb-2" aria-label="pages">
      {state.content.pages.map((p, i) => {
        const active = p.id === state.selectedPageId;
        const isSkipped = skipped.has(p.id);
        const isIncomplete = !isSkipped && blockingPageIds.has(p.id);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              if (!isSkipped) dispatch({ type: 'SET_PAGE', pageId: p.id });
            }}
            disabled={isSkipped}
            title={isSkipped ? t('skippedTooltip') : isIncomplete ? t('pageIncomplete') : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs transition-colors ${
              active
                ? 'bg-accent text-accent-foreground'
                : isSkipped
                  ? 'text-muted-foreground/40 line-through'
                  : 'text-muted-foreground hover:bg-accent/60'
            }`}
          >
            <span>
              {i + 1}. {p.title}
            </span>
            {isIncomplete ? (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                aria-label={t('pageIncomplete')}
              />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

function PageBody({
  page,
  readonly,
  actionRaisedMap,
  onActionRaised,
  onOpenAction,
}: {
  page: Page;
  readonly: boolean;
  actionRaisedMap: Map<string, string>;
  onActionRaised: (questionId: string, actionId: string) => void;
  onOpenAction: (actionId: string) => void;
}) {
  return (
    <div className="space-y-6">
      {page.description !== undefined ? (
        <p className="text-sm text-muted-foreground">{page.description}</p>
      ) : null}
      {page.sections.map((section) => (
        <SectionBody
          key={section.id}
          section={section}
          readonly={readonly}
          actionRaisedMap={actionRaisedMap}
          onActionRaised={onActionRaised}
          onOpenAction={onOpenAction}
        />
      ))}
    </div>
  );
}

/**
 * Renders a section heading + one card per question item.
 * Each item gets its own Card so users can clearly distinguish
 * individual questions (SafetyCulture parity).
 */
function SectionBody({
  section,
  readonly,
  actionRaisedMap,
  onActionRaised,
  onOpenAction,
}: {
  section: Section;
  readonly: boolean;
  actionRaisedMap: Map<string, string>;
  onActionRaised: (questionId: string, actionId: string) => void;
  onOpenAction: (actionId: string) => void;
}) {
  const { state } = useConduct();
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{section.title}</h2>
        {section.description !== undefined ? (
          <p className="text-sm text-muted-foreground">{section.description}</p>
        ) : null}
      </div>
      <div className="space-y-3">
        {section.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            readonly={readonly}
            customResponseSets={state.content.customResponseSets}
            raisedActionId={actionRaisedMap.get(item.id) ?? null}
            onActionRaised={onActionRaised}
            onOpenAction={onOpenAction}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One Card per question item. The card gives each question a clear visual
 * boundary matching SafetyCulture's per-question-card layout.
 */
function ItemRow({
  item,
  readonly,
  customResponseSets,
  raisedActionId,
  onActionRaised,
  onOpenAction,
}: {
  item: Item;
  readonly: boolean;
  customResponseSets: Parameters<typeof ResponseInput>[0]['responseSets'];
  /** Action ID if one has been raised for this question, null otherwise. */
  raisedActionId: string | null;
  onActionRaised: (questionId: string, actionId: string) => void;
  onOpenAction: (actionId: string) => void;
}) {
  const { state } = useConduct();
  const visible = isItemRevealed(item, state.content, state.responses);
  if (!visible) return null;
  const prompt = 'prompt' in item ? item.prompt : null;
  const required = 'required' in item && item.required === true;
  const evidenceNeed = requiredEvidenceCount(state.content, item.id, state.responses);
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        {prompt !== null ? (
          <label className="text-sm font-medium leading-snug" htmlFor={`item-${item.id}`}>
            {prompt}
            {required ? <span className="ml-1 text-destructive">*</span> : null}
          </label>
        ) : (
          <span />
        )}
        {item.type !== 'instruction' ? (
          <RaiseActionTrigger
            inspectionId={state.inspectionId}
            questionId={item.id}
            questionPrompt={prompt}
            hasAction={raisedActionId !== null}
            onActionRaised={onActionRaised}
          />
        ) : null}
      </div>
      <div id={`item-${item.id}`}>
        <ResponseInput item={item} readonly={readonly} responseSets={customResponseSets} />
      </div>
      {evidenceNeed > 0 ? (
        <EvidenceUploader itemId={item.id} need={evidenceNeed} readonly={readonly} />
      ) : null}
      {raisedActionId !== null ? (
        <LinkedActionCard actionId={raisedActionId} onOpen={() => onOpenAction(raisedActionId)} />
      ) : null}
      {'note' in item && item.note !== undefined ? (
        <p className="text-xs text-muted-foreground">{item.note}</p>
      ) : null}
    </Card>
  );
}

// Status colours shared between the card and the sidebar panel.
const ACTION_STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
  in_progress: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  cancelled: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
};

/**
 * Compact card shown below a question when an action has been raised.
 * Fetches the action title + status and opens the full detail sidebar on click.
 */
function LinkedActionCard({ actionId, onOpen }: { actionId: string; onOpen: () => void }) {
  const t = useTranslations('inspections.conduct');
  const tActionStatus = useTranslations('actions.status');
  const { data, isLoading } = trpc.actions.get.useQuery({ actionId });
  const action = data?.action;

  if (isLoading) {
    return <Skeleton className="h-10 w-full rounded-md" />;
  }
  if (action === undefined) return null;

  const statusColor = ACTION_STATUS_COLORS[action.status] ?? ACTION_STATUS_COLORS['open'];
  const statusLabel = tActionStatus(action.status as 'open');

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 rounded-md border bg-muted/40 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
      aria-label={t('openLinkedAction', { title: action.title })}
    >
      <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-xs font-medium', statusColor)}>
        {statusLabel}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{action.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{action.referenceNumber}</span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-muted-foreground"
        aria-hidden="true"
      >
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      </svg>
    </button>
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

type Priority = 'low' | 'medium' | 'high' | 'critical';
const PRIORITIES: ReadonlyArray<Priority> = ['low', 'medium', 'high', 'critical'];

/**
 * Per-question "Raise action" affordance. Opens the full action-creation
 * dialog (matching the standalone /actions/new page) so users can pick an
 * action type, fill custom questions, assign, set site, label, etc.
 * On submit fires `actions.createFromInspectionQuestion` (idempotent on
 * the {inspectionId, questionId} pair — re-raising returns the existing
 * action). After a successful raise, shows a green "Action raised" badge
 * alongside a re-raise link so users have a clear indicator.
 */
function RaiseActionTrigger({
  inspectionId,
  questionId,
  questionPrompt,
  hasAction,
  onActionRaised,
}: {
  inspectionId: string;
  questionId: string;
  questionPrompt: string | null;
  hasAction: boolean;
  onActionRaised: (questionId: string, actionId: string) => void;
}) {
  const t = useTranslations('actions.raiseFromInspection');
  const tCreate = useTranslations('actions.create');
  const tCreateType = useTranslations('actions.create.type');
  const tPriority = useTranslations('actions.priority');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();

  const [open, setOpen] = useState(false);

  // Form state — mirrors NewActionPage
  const [actionTypeId, setActionTypeId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'' | Priority>('');
  const [dueAt, setDueAt] = useState('');
  const [dueAtAutoSet, setDueAtAutoSet] = useState(false);
  const [siteId, setSiteId] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [label, setLabel] = useState('');
  const [customResponses, setCustomResponses] = useState<Record<string, unknown>>({});

  const { data: sites } = trpc.sites.list.useQuery(undefined, { enabled: open });
  const { data: usersData } = trpc.users.list.useQuery({}, { enabled: open });
  const users = usersData?.users ?? [];
  const { data: types } = trpc.actionTypes.list.useQuery(
    { includeArchived: false },
    { enabled: open },
  );
  const { data: actionSettings } = trpc.actionTypes.settings.get.useQuery(undefined, {
    enabled: open,
  });

  const selectedType = useMemo(
    () => (types ?? []).find((tp) => tp.id === actionTypeId) ?? null,
    [types, actionTypeId],
  );

  // Default to the tenant's default action type on first open.
  useEffect(() => {
    if (!open) return;
    if (actionTypeId !== '') return;
    if (!types || types.length === 0) return;
    const fallback = types.find((tp) => tp.isDefault) ?? null;
    if (fallback !== null) setActionTypeId(fallback.id);
  }, [open, types, actionTypeId]);

  // Reset custom responses + label when type changes.
  useEffect(() => {
    setCustomResponses({});
    setLabel('');
  }, [actionTypeId]);

  // Pre-seed the title with the question prompt on open.
  useEffect(() => {
    if (open && title === '' && questionPrompt !== null) {
      setTitle(questionPrompt);
    }
  }, [open, title, questionPrompt]);

  const required = selectedType?.requiredFields ?? [];
  const isRequired = (
    field: 'description' | 'assignee' | 'priority' | 'dueDate' | 'site',
  ): boolean => required.includes(field);

  const customResponsesValid = useMemo(() => {
    if (selectedType === null) return true;
    for (const q of selectedType.customQuestions) {
      if (!q.required) continue;
      const v = customResponses[q.id];
      if (v === undefined || v === null) return false;
      if (typeof v === 'string' && v.trim() === '') return false;
    }
    return true;
  }, [selectedType, customResponses]);

  const requiredFieldsValid =
    (!isRequired('description') || description.trim() !== '') &&
    (!isRequired('priority') || priority !== '') &&
    (!isRequired('dueDate') || dueAt !== '') &&
    (!isRequired('site') || siteId !== '') &&
    (!isRequired('assignee') || assigneeUserId !== '');

  function resetForm(): void {
    setActionTypeId('');
    setTitle('');
    setDescription('');
    setPriority('');
    setDueAt('');
    setDueAtAutoSet(false);
    setSiteId('');
    setAssigneeUserId('');
    setLabel('');
    setCustomResponses({});
  }

  const create = trpc.actions.createFromInspectionQuestion.useMutation({
    onSuccess: (data) => {
      toast.success(t('createdToast'));
      setOpen(false);
      resetForm();
      void utils.actions.list.invalidate();
      void utils.actions.get.invalidate({ actionId: data.actionId });
      onActionRaised(questionId, data.actionId);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const canSubmit =
    title.trim().length > 0 && !create.isPending && customResponsesValid && requiredFieldsValid;

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!canSubmit) return;
    const payload: Parameters<typeof create.mutate>[0] = {
      inspectionId,
      sourceItemId: questionId,
      title: title.trim(),
    };
    if (description.trim().length > 0) payload.description = description.trim();
    if (priority !== '') payload.priority = priority;
    if (dueAt !== '') payload.dueAt = new Date(dueAt).toISOString();
    if (siteId !== '') payload.siteId = siteId;
    if (assigneeUserId !== '') payload.assigneeUserId = assigneeUserId;
    if (label.trim().length > 0) payload.label = label.trim();
    if (actionTypeId !== '') {
      payload.actionTypeId = actionTypeId;
      if (selectedType !== null && selectedType.customQuestions.length > 0) {
        payload.customQuestionResponses = customResponses;
      }
    }
    create.mutate(payload);
  }

  return (
    <>
      {/* ── Trigger ─────────────────────────────────────────────────────── */}
      {hasAction ? (
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            ✓ {t('actionRaisedLabel')}
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            {t('triggerLabel')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {t('triggerLabel')}
        </button>
      )}

      {/* ── Full action-creation dialog ──────────────────────────────────── */}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) resetForm();
          setOpen(next);
        }}
      >
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
          <DialogHeader className="shrink-0">
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
            <DialogDescription>{t('dialogSubtitle')}</DialogDescription>
          </DialogHeader>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-1 py-2">
            {/* Source question context strip */}
            {questionPrompt !== null ? (
              <p className="mb-4 rounded-md bg-muted px-3 py-2 text-xs">
                <span className="font-medium">{t('questionLabel')}: </span>
                {questionPrompt}
              </p>
            ) : null}

            <form id="raise-action-form" onSubmit={onSubmit} className="space-y-4">
              {/* Action type */}
              {types !== undefined && types.length > 0 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="ra-type">{tCreateType('label')}</Label>
                  <select
                    id="ra-type"
                    value={actionTypeId}
                    onChange={(e) => setActionTypeId(e.target.value)}
                    className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">{tCreateType('none')}</option>
                    {types.map((tp) => (
                      <option key={tp.id} value={tp.id}>
                        {tp.name}
                        {tp.isDefault ? ` (${tCreateType('defaultSuffix')})` : ''}
                      </option>
                    ))}
                  </select>
                  {selectedType !== null && selectedType.description !== null ? (
                    <p className="text-xs text-muted-foreground">{selectedType.description}</p>
                  ) : null}
                </div>
              ) : null}

              {/* Title */}
              <div className="space-y-1.5">
                <Label htmlFor="ra-title">
                  {tCreate('titleLabel')}
                  <span className="ml-1 text-destructive">*</span>
                </Label>
                <Input
                  id="ra-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={tCreate('titlePlaceholder')}
                  maxLength={500}
                  required
                  autoFocus
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label htmlFor="ra-description">
                  {tCreate('descriptionLabel')}
                  {isRequired('description') ? (
                    <span className="ml-1 text-destructive">*</span>
                  ) : null}
                </Label>
                <Textarea
                  id="ra-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={tCreate('descriptionPlaceholder')}
                  rows={3}
                  maxLength={20_000}
                />
              </div>

              {/* Priority + Due date */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ra-priority">
                    {tCreate('priorityLabel')}
                    {isRequired('priority') ? (
                      <span className="ml-1 text-destructive">*</span>
                    ) : null}
                  </Label>
                  <select
                    id="ra-priority"
                    value={priority}
                    onChange={(e) => {
                      const next = e.target.value as '' | Priority;
                      setPriority(next);
                      if (dueAtAutoSet || dueAt === '') {
                        if (next === '') {
                          setDueAt('');
                          setDueAtAutoSet(false);
                        } else {
                          const days =
                            actionSettings?.priorityDueDateDays[next] ??
                            { low: 30, medium: 7, high: 1, critical: 1 }[next];
                          if (days !== null && days !== undefined && days > 0) {
                            const d = new Date(Date.now() + days * 86_400_000);
                            const pad = (n: number) => String(n).padStart(2, '0');
                            setDueAt(
                              `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
                            );
                            setDueAtAutoSet(true);
                          }
                        }
                      }
                    }}
                    className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">{tCreate('noPriority')}</option>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {tPriority(p)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ra-due">
                    {tCreate('dueDateLabel')}
                    {isRequired('dueDate') ? (
                      <span className="ml-1 text-destructive">*</span>
                    ) : null}
                  </Label>
                  <Input
                    id="ra-due"
                    type="datetime-local"
                    value={dueAt}
                    onChange={(e) => {
                      setDueAt(e.target.value);
                      setDueAtAutoSet(false);
                    }}
                  />
                </div>
              </div>

              {/* Site + Assignee */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ra-site">
                    {tCreate('siteLabel')}
                    {isRequired('site') ? <span className="ml-1 text-destructive">*</span> : null}
                  </Label>
                  <select
                    id="ra-site"
                    value={siteId}
                    onChange={(e) => setSiteId(e.target.value)}
                    className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">{tCreate('siteNoneOption')}</option>
                    {(sites ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ra-assignee">
                    {tCreate('assigneeLabel')}
                    {isRequired('assignee') ? (
                      <span className="ml-1 text-destructive">*</span>
                    ) : null}
                  </Label>
                  <select
                    id="ra-assignee"
                    value={assigneeUserId}
                    onChange={(e) => setAssigneeUserId(e.target.value)}
                    className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">—</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Label */}
              <div className="space-y-1.5">
                <Label htmlFor="ra-label">{tCreate('labelLabel')}</Label>
                {selectedType !== null && selectedType.labels.length > 0 ? (
                  <select
                    id="ra-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">{tCreate('labelNoneOption')}</option>
                    {selectedType.labels.map((lbl) => (
                      <option key={lbl} value={lbl}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id="ra-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={tCreate('labelPlaceholder')}
                    maxLength={80}
                  />
                )}
              </div>

              {/* Custom questions from the selected action type */}
              {selectedType !== null && selectedType.customQuestions.length > 0 ? (
                <RaiseActionCustomQuestions
                  questions={[...selectedType.customQuestions]}
                  responses={customResponses}
                  onChange={setCustomResponses}
                />
              ) : null}
            </form>
          </div>

          <DialogFooter className="shrink-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                resetForm();
                setOpen(false);
              }}
            >
              {t('cancelButton')}
            </Button>
            <Button form="raise-action-form" type="submit" disabled={!canSubmit}>
              {t('saveButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Custom questions sub-form for the raise-action dialog.
 * Mirrors `CustomQuestionsForm` in /actions/new/page.tsx.
 */
function RaiseActionCustomQuestions({
  questions,
  responses,
  onChange,
}: {
  questions: ActionCustomQuestion[];
  responses: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const t = useTranslations('actions.create.questions');

  function update(id: string, value: unknown): void {
    onChange({ ...responses, [id]: value });
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-4">
      <h3 className="text-sm font-medium">{t('heading')}</h3>
      {questions.map((q) => (
        <div key={q.id} className="space-y-1.5">
          <Label htmlFor={`raq-${q.id}`}>
            {q.prompt}
            {q.required ? <span className="ml-1 text-destructive">*</span> : null}
          </Label>
          {q.type === 'text' ? (
            <Textarea
              id={`raq-${q.id}`}
              value={typeof responses[q.id] === 'string' ? (responses[q.id] as string) : ''}
              onChange={(e) => update(q.id, e.target.value)}
              rows={2}
              maxLength={2000}
            />
          ) : q.type === 'number' ? (
            <Input
              id={`raq-${q.id}`}
              type="number"
              value={
                typeof responses[q.id] === 'number'
                  ? String(responses[q.id])
                  : typeof responses[q.id] === 'string'
                    ? (responses[q.id] as string)
                    : ''
              }
              onChange={(e) => update(q.id, e.target.value === '' ? '' : Number(e.target.value))}
            />
          ) : (
            <select
              id={`raq-${q.id}`}
              value={typeof responses[q.id] === 'string' ? (responses[q.id] as string) : ''}
              onChange={(e) => update(q.id, e.target.value)}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">{t('selectPlaceholder')}</option>
              {(q.options ?? []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}
    </div>
  );
}
