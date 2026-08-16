'use client';

/**
 * Method-statement editor.
 *
 * RS-A12: the library shipped read-and-clone only — `saveDraft` and
 * `publish` had no caller, so a contractor could duplicate a starter
 * template into a copy they could never change. This is the missing half:
 * edit the sequence of operations, the scope, the emergency block and the
 * logistics block, then publish a version that packs can start from.
 *
 * Deliberately narrower than the pack builder. A library template is a
 * reusable skeleton, so it carries no RA bindings and no hazard
 * references — those are bound per job, in the pack, where the residual
 * risk is real. What the template does carry is the structure that makes
 * the twenty-minute bar reachable.
 */
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HOLD_POINT_KINDS,
  METHOD_STATEMENT_TRADES,
  MAX_METHOD_STATEMENT_STEPS,
  PPE_ITEMS,
  resequenceSteps,
  type HoldPointKind,
  type MethodStatementContent,
  type MethodStatementStep,
  type MethodStatementTrade,
  type PpeItem,
} from '@forma360/shared/rams';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import { Input } from '../../../../../src/components/ui/input';
import { Label } from '../../../../../src/components/ui/label';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../../src/lib/permissions-context';
import { trpc } from '../../../../../src/lib/trpc/client';
import { formatDate } from '../../../../../src/lib/format-date';

/** Stable-enough client id for a new step — mirrors the pack builder. */
function newStepId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const AUTOSAVE_DELAY_MS = 900;

export default function MethodStatementEditorPage() {
  const t = useTranslations('rams');
  const params = useParams<{ locale: string; methodStatementId: string }>();
  const { locale, methodStatementId } = params;
  const canCreate = useHasPermission('rams.create');

  const utils = trpc.useUtils();
  const query = trpc.rams.methodStatements.get.useQuery({ methodStatementId });

  const [draft, setDraft] = useState<MethodStatementContent | null>(null);
  const [title, setTitle] = useState('');
  const [trade, setTrade] = useState<MethodStatementTrade>('other');
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ms = query.data?.methodStatement;
  const versions = query.data?.versions ?? [];

  // Hydrate the local draft once the server row arrives.
  useEffect(() => {
    if (ms !== undefined && draft === null) {
      setDraft(ms.draftContent);
      setTitle(ms.title);
      setTrade(ms.trade);
    }
  }, [ms, draft]);

  const saveDraft = trpc.rams.methodStatements.saveDraft.useMutation({
    onSuccess: () => {
      setSaveError(null);
      setSavedAt(new Date());
      void utils.rams.methodStatements.list.invalidate();
    },
    // RS-A14: a save that fails silently is a document the author believes
    // is written and is not.
    onError: (err) => setSaveError(err.message),
  });

  const publish = trpc.rams.methodStatements.publish.useMutation({
    onSuccess: () => {
      setPublishError(null);
      void utils.rams.methodStatements.get.invalidate({ methodStatementId });
      void utils.rams.methodStatements.list.invalidate();
    },
    onError: (err) => setPublishError(err.message),
  });

  const scheduleSave = useCallback(
    (next: MethodStatementContent, nextTitle: string, nextTrade: MethodStatementTrade) => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        saveDraft.mutate({
          methodStatementId,
          title: nextTitle.trim().length > 0 ? nextTitle.trim() : undefined,
          trade: nextTrade,
          content: next,
        });
      }, AUTOSAVE_DELAY_MS);
    },
    [methodStatementId, saveDraft],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const update = useCallback(
    (fn: (d: MethodStatementContent) => MethodStatementContent) => {
      setDraft((current) => {
        if (current === null) return current;
        const next = fn(current);
        scheduleSave(next, title, trade);
        return next;
      });
    },
    [scheduleSave, title, trade],
  );

  function updateStep(id: string, fn: (s: MethodStatementStep) => MethodStatementStep): void {
    update((d) => ({ ...d, steps: d.steps.map((s) => (s.id === id ? fn(s) : s)) }));
  }

  function moveStep(index: number, delta: number): void {
    update((d) => {
      const steps = [...d.steps];
      const target = index + delta;
      const a = steps[index];
      const b = steps[target];
      if (a === undefined || b === undefined) return d;
      steps[index] = b;
      steps[target] = a;
      return { ...d, steps: resequenceSteps(steps) };
    });
  }

  if (query.isPending || ms === undefined || draft === null) {
    return (
      <main className="mx-auto w-full max-w-4xl space-y-3 px-4 py-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  const readOnly = !canCreate || ms.archivedAt !== null;
  const hasUnpublishedChanges =
    ms.status === 'draft' || ms.updatedAt.getTime() > (ms.publishedAt?.getTime() ?? 0);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <div className="mb-4">
        <Link
          href={`/${locale}/rams/library`}
          className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t('library.backToLibrary')}
        </Link>
      </div>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-64 flex-1">
          <Input
            value={title}
            disabled={readOnly}
            aria-label={t('editor.titleLabel')}
            className="h-auto border-0 px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
            onChange={(e) => {
              const next = e.target.value;
              setTitle(next);
              if (draft !== null) scheduleSave(draft, next, trade);
            }}
          />
          <p className="text-muted-foreground text-sm">
            {ms.currentVersion > 0
              ? t('versionLabel', { version: ms.currentVersion })
              : t('editor.neverPublished')}
            {savedAt !== null ? ` · ${t('editor.saved')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={trade}
            disabled={readOnly}
            aria-label={t('editor.tradeLabel')}
            className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
            onChange={(e) => {
              const next = e.target.value as MethodStatementTrade;
              setTrade(next);
              if (draft !== null) scheduleSave(draft, title, next);
            }}
          >
            {METHOD_STATEMENT_TRADES.map((tr) => (
              <option key={tr} value={tr}>
                {t(`trade.${tr}`)}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            disabled={readOnly || publish.isPending || draft.steps.length === 0}
            onClick={() => publish.mutate({ methodStatementId })}
          >
            {t('editor.publish')}
          </Button>
        </div>
      </header>

      {saveError !== null ? (
        <p className="mb-3 flex items-start gap-1.5 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t('editor.saveFailed', { message: saveError })}
        </p>
      ) : null}
      {publishError !== null ? (
        <p className="mb-3 flex items-start gap-1.5 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t('editor.publishFailed', { message: publishError })}
        </p>
      ) : null}
      {ms.archivedAt !== null ? (
        <p className="bg-muted mb-3 rounded-md p-3 text-sm">{t('editor.archived')}</p>
      ) : hasUnpublishedChanges && ms.currentVersion > 0 ? (
        <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          {t('editor.unpublishedChanges')}
        </p>
      ) : null}

      {/* Scope */}
      <Card className="mb-4">
        <CardContent className="py-4">
          <Label htmlFor="ms-scope">{t('editor.scopeLabel')}</Label>
          <Textarea
            id="ms-scope"
            rows={3}
            disabled={readOnly}
            className="mt-1.5"
            value={draft.scopeOfWorks}
            placeholder={t('editor.scopePlaceholder')}
            onChange={(e) => {
              const value = e.target.value;
              update((d) => ({ ...d, scopeOfWorks: value }));
            }}
          />
        </CardContent>
      </Card>

      {/* Steps */}
      <Card className="mb-4">
        <CardContent className="py-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">{t('steps.title')}</h2>
            <Button
              type="button"
              size="sm"
              disabled={readOnly || draft.steps.length >= MAX_METHOD_STATEMENT_STEPS}
              onClick={() => {
                const id = newStepId();
                update((d) => ({
                  ...d,
                  steps: resequenceSteps([
                    ...d.steps,
                    {
                      id,
                      sequence: d.steps.length + 1,
                      title: '',
                      description: '',
                      hazardRefs: [],
                      controlNotes: '',
                      plant: [],
                      substanceRefs: [],
                      ppe: [],
                      ppeOther: '',
                      personnel: [],
                      holdPoint: null,
                      environmentalNotes: '',
                    },
                  ]),
                }));
                setOpenStep(id);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              {t('steps.add')}
            </Button>
          </div>

          {draft.steps.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('steps.none')}</p>
          ) : (
            <ol className="space-y-2">
              {draft.steps.map((step, index) => {
                const open = openStep === step.id;
                return (
                  <li key={step.id} className="rounded-md border">
                    <div className="flex items-center gap-2 p-3">
                      <span className="bg-muted inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                        {step.sequence}
                      </span>
                      <button
                        type="button"
                        className="flex-1 text-left text-sm font-medium"
                        onClick={() => setOpenStep(open ? null : step.id)}
                        aria-expanded={open}
                      >
                        {step.title.trim().length > 0 ? step.title : t('steps.untitled')}
                      </button>
                      {step.holdPoint !== null ? (
                        <span className="bg-muted rounded-full px-2 py-0.5 text-xs">
                          {t('steps.holdPointBadge')}
                        </span>
                      ) : null}
                      {!readOnly ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={index === 0}
                            aria-label={t('steps.moveUp')}
                            onClick={() => moveStep(index, -1)}
                          >
                            <ChevronUp className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={index === draft.steps.length - 1}
                            aria-label={t('steps.moveDown')}
                            onClick={() => moveStep(index, 1)}
                          >
                            <ChevronDown className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={t('steps.remove')}
                            onClick={() =>
                              update((d) => ({
                                ...d,
                                steps: resequenceSteps(d.steps.filter((s) => s.id !== step.id)),
                              }))
                            }
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        </>
                      ) : null}
                    </div>

                    {open ? (
                      <div className="space-y-3 border-t p-3">
                        <div>
                          <Label htmlFor={`step-title-${step.id}`}>
                            {t('steps.titlePlaceholder')}
                          </Label>
                          <Input
                            id={`step-title-${step.id}`}
                            className="mt-1"
                            disabled={readOnly}
                            value={step.title}
                            onChange={(e) => {
                              const value = e.target.value;
                              updateStep(step.id, (s) => ({ ...s, title: value }));
                            }}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`step-desc-${step.id}`}>{t('steps.description')}</Label>
                          <Textarea
                            id={`step-desc-${step.id}`}
                            rows={3}
                            className="mt-1"
                            disabled={readOnly}
                            value={step.description}
                            onChange={(e) => {
                              const value = e.target.value;
                              updateStep(step.id, (s) => ({ ...s, description: value }));
                            }}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`step-controls-${step.id}`}>
                            {t('steps.controlNotes')}
                          </Label>
                          <Textarea
                            id={`step-controls-${step.id}`}
                            rows={2}
                            className="mt-1"
                            disabled={readOnly}
                            value={step.controlNotes}
                            onChange={(e) => {
                              const value = e.target.value;
                              updateStep(step.id, (s) => ({ ...s, controlNotes: value }));
                            }}
                          />
                        </div>
                        <fieldset>
                          <legend className="text-sm font-medium">{t('steps.ppe')}</legend>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {PPE_ITEMS.map((item: PpeItem) => {
                              const on = step.ppe.includes(item);
                              return (
                                <button
                                  key={item}
                                  type="button"
                                  disabled={readOnly}
                                  aria-pressed={on}
                                  className={`rounded-full border px-2.5 py-1 text-xs ${
                                    on ? 'bg-foreground text-background' : 'hover:bg-muted'
                                  }`}
                                  onClick={() =>
                                    updateStep(step.id, (s) => ({
                                      ...s,
                                      ppe: on
                                        ? s.ppe.filter((p) => p !== item)
                                        : [...s.ppe, item].sort(),
                                    }))
                                  }
                                >
                                  {t(`ppe.${item}`)}
                                </button>
                              );
                            })}
                          </div>
                        </fieldset>
                        <div>
                          <Label htmlFor={`step-hold-${step.id}`}>{t('steps.holdPoint')}</Label>
                          <select
                            id={`step-hold-${step.id}`}
                            className="border-input mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                            disabled={readOnly}
                            value={step.holdPoint?.kind ?? ''}
                            onChange={(e) => {
                              const value = e.target.value;
                              updateStep(step.id, (s) => ({
                                ...s,
                                holdPoint:
                                  value === ''
                                    ? null
                                    : {
                                        kind: value as HoldPointKind,
                                        description: s.holdPoint?.description ?? '',
                                        responsibleRole: s.holdPoint?.responsibleRole ?? '',
                                      },
                              }));
                            }}
                          >
                            <option value="">{t('steps.noHoldPoint')}</option>
                            {HOLD_POINT_KINDS.map((kind) => (
                              <option key={kind} value={kind}>
                                {t(`holdPointKind.${kind}`)}
                              </option>
                            ))}
                          </select>
                          {step.holdPoint !== null ? (
                            <Input
                              className="mt-1.5"
                              disabled={readOnly}
                              placeholder={t('steps.holdPointPlaceholder')}
                              aria-label={t('steps.holdPointPlaceholder')}
                              value={step.holdPoint.description}
                              onChange={(e) => {
                                const value = e.target.value;
                                updateStep(step.id, (s) => ({
                                  ...s,
                                  holdPoint:
                                    s.holdPoint === null
                                      ? null
                                      : { ...s.holdPoint, description: value },
                                }));
                              }}
                            />
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Emergency block */}
      <Card className="mb-4">
        <CardContent className="space-y-3 py-4">
          <h2 className="font-semibold">{t('emergency.title')}</h2>
          {(
            [
              ['firstAid', t('emergency.firstAid')],
              ['emergencyProcedure', t('emergency.procedure')],
              ['rescuePlan', t('emergency.rescuePlan')],
            ] as ReadonlyArray<['firstAid' | 'emergencyProcedure' | 'rescuePlan', string]>
          ).map(([field, label]) => (
            <div key={field}>
              <Label htmlFor={`emergency-${field}`}>{label}</Label>
              <Textarea
                id={`emergency-${field}`}
                rows={2}
                className="mt-1"
                disabled={readOnly}
                value={draft.emergency[field]}
                onChange={(e) => {
                  const value = e.target.value;
                  update((d) => ({ ...d, emergency: { ...d.emergency, [field]: value } }));
                }}
              />
            </div>
          ))}
          <div>
            <Label htmlFor="emergency-hospital">{t('emergency.nearestHospital')}</Label>
            <Input
              id="emergency-hospital"
              className="mt-1"
              disabled={readOnly}
              value={draft.emergency.nearestHospital}
              onChange={(e) => {
                const value = e.target.value;
                update((d) => ({ ...d, emergency: { ...d.emergency, nearestHospital: value } }));
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Logistics block */}
      <Card className="mb-4">
        <CardContent className="space-y-3 py-4">
          <h2 className="font-semibold">{t('logistics.title')}</h2>
          {(
            [
              ['welfare', t('logistics.welfare')],
              ['environmental', t('logistics.environmental')],
              ['accessEgress', t('logistics.accessEgress')],
              ['permitsRequired', t('logistics.permitsRequired')],
              ['competence', t('logistics.competence')],
            ] as ReadonlyArray<
              [
                'welfare' | 'environmental' | 'accessEgress' | 'permitsRequired' | 'competence',
                string,
              ]
            >
          ).map(([field, label]) => (
            <div key={field}>
              <Label htmlFor={`logistics-${field}`}>{label}</Label>
              <Textarea
                id={`logistics-${field}`}
                rows={2}
                className="mt-1"
                disabled={readOnly}
                value={draft.logistics[field]}
                onChange={(e) => {
                  const value = e.target.value;
                  update((d) => ({ ...d, logistics: { ...d.logistics, [field]: value } }));
                }}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Published versions */}
      {versions.length > 0 ? (
        <Card>
          <CardContent className="py-4">
            <h2 className="mb-2 font-semibold">{t('editor.versionsTitle')}</h2>
            <ul className="divide-y text-sm">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center gap-2 py-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                  <span className="font-medium">
                    {t('versionLabel', { version: v.versionNumber })}
                  </span>
                  <span className="text-muted-foreground">
                    {t('editor.publishedBy', {
                      name: v.publishedByName ?? '—',
                      date: formatDate(v.publishedAt, locale),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
