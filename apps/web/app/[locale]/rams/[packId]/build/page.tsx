'use client';

/**
 * The RAMS pack builder — BUG-01.
 *
 * The pack page has always linked here ("Open the builder") and the route
 * did not exist, so every RAMS pack in the product dead-ended at a 404.
 * Four HSE practitioners independently hit it; the module could not
 * produce its one deliverable. `rams.packs.saveDraft`,
 * `bindRiskAssessment`, `bindCoshh` and `suggestBindings` were all
 * shipped and callable — nothing called them.
 *
 * The builder is deliberately more than the library editor
 * (`rams/library/[methodStatementId]`), because a pack is a job and a
 * template is a skeleton. What it adds is the part that makes a pack a
 * RAMS rather than a method statement: **bindings**, and per-step hazard
 * references into them.
 *
 * ADR 0015's headline rule is that a step REFERENCES a hazard in a bound
 * RA version instead of restating it. That rule only means anything if
 * the author can see the bound hazards while writing the step — so the
 * hazard picker lists them inline, and the issue gate's
 * `unreferencedHighRiskHazards` blocker is shown live at the top rather
 * than being discovered at issue time. An author who finds out about an
 * unaddressed high-risk hazard only when the issue button refuses has
 * already written the wrong document.
 *
 * Autosave matches the library editor (debounced `saveDraft`), and a
 * failed save is shown, never swallowed — RS-A14.
 */
import { AlertCircle, ArrowLeft, ChevronDown, ChevronUp, Link2, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HOLD_POINT_KINDS,
  MAX_METHOD_STATEMENT_STEPS,
  PPE_ITEMS,
  resequenceSteps,
  type HazardRef,
  type HoldPointKind,
  type MethodStatementContent,
  type MethodStatementStep,
  type PpeItem,
} from '@forma360/shared/rams';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import { Input } from '../../../../../src/components/ui/input';
import { Label } from '../../../../../src/components/ui/label';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../../src/lib/permissions-context';
import { serverErrorMessage } from '../../../../../src/lib/server-error';
import { trpc } from '../../../../../src/lib/trpc/client';

/** Stable-enough client id for a new step — mirrors the library editor. */
function newStepId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const AUTOSAVE_DELAY_MS = 900;

export default function RamsPackBuilderPage() {
  const t = useTranslations('rams');
  const tShared = useTranslations('serverErrors');
  const params = useParams<{ locale: string; packId: string }>();
  const { locale, packId } = params;
  const canCreate = useHasPermission('rams.create');

  const utils = trpc.useUtils();
  const query = trpc.rams.packs.get.useQuery({ packId });
  const suggestions = trpc.rams.packs.suggestBindings.useQuery({ packId });

  const [draft, setDraft] = useState<MethodStatementContent | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pack = query.data?.pack;
  const boundRas = query.data?.riskAssessments ?? [];
  const boundCoshh = query.data?.coshh ?? [];
  const gate = query.data?.issueGate;

  // Hydrate the local draft once the server row arrives.
  useEffect(() => {
    if (pack !== undefined && draft === null) setDraft(pack.draftContent);
  }, [pack, draft]);

  const saveDraft = trpc.rams.packs.saveDraft.useMutation({
    onSuccess: () => {
      setSaveError(null);
      setSaving(false);
      setSavedAt(new Date());
      // The issue gate is computed from the saved content, so it has to be
      // re-read for the blocker list at the top to mean anything.
      void utils.rams.packs.get.invalidate({ packId });
    },
    // RS-A14: a save that fails silently is a document the author believes
    // is written and is not.
    onError: (err) => {
      setSaving(false);
      setSaveError(serverErrorMessage(err, tShared, t('editor.saveFailedGeneric')));
    },
  });

  const invalidatePack = useCallback(async () => {
    await utils.rams.packs.get.invalidate({ packId });
    await utils.rams.packs.suggestBindings.invalidate({ packId });
  }, [utils, packId]);

  const bindRa = trpc.rams.packs.bindRiskAssessment.useMutation({
    onSuccess: invalidatePack,
    onError: (err) => setSaveError(serverErrorMessage(err, tShared, t('editor.saveFailedGeneric'))),
  });
  const unbindRa = trpc.rams.packs.unbindRiskAssessment.useMutation({
    onSuccess: invalidatePack,
    onError: (err) => setSaveError(serverErrorMessage(err, tShared, t('editor.saveFailedGeneric'))),
  });
  const bindCoshh = trpc.rams.packs.bindCoshh.useMutation({
    onSuccess: invalidatePack,
    onError: (err) => setSaveError(serverErrorMessage(err, tShared, t('editor.saveFailedGeneric'))),
  });
  const unbindCoshh = trpc.rams.packs.unbindCoshh.useMutation({
    onSuccess: invalidatePack,
    onError: (err) => setSaveError(serverErrorMessage(err, tShared, t('editor.saveFailedGeneric'))),
  });

  const scheduleSave = useCallback(
    (next: MethodStatementContent) => {
      if (timer.current !== null) clearTimeout(timer.current);
      setSaving(true);
      timer.current = setTimeout(() => {
        saveDraft.mutate({ packId, content: next });
      }, AUTOSAVE_DELAY_MS);
    },
    [packId, saveDraft],
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
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
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

  function toggleHazardRef(stepId: string, ref: HazardRef): void {
    updateStep(stepId, (s) => {
      const on = s.hazardRefs.some(
        (h) => h.raVersionId === ref.raVersionId && h.hazardIndex === ref.hazardIndex,
      );
      return {
        ...s,
        hazardRefs: on
          ? s.hazardRefs.filter(
              (h) => !(h.raVersionId === ref.raVersionId && h.hazardIndex === ref.hazardIndex),
            )
          : [...s.hazardRefs, ref],
      };
    });
  }

  if (query.isPending || pack === undefined || draft === null) {
    return (
      <main className="mx-auto w-full max-w-4xl space-y-3 px-4 py-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  // `saveDraft` refuses anything that is not draft-or-issued; mirror that
  // here rather than letting the author type into a form that will refuse.
  const readOnly = !canCreate || (pack.status !== 'draft' && pack.status !== 'issued');

  /** Every hazard in every bound RA version, flattened for the picker. */
  const allHazards = boundRas.flatMap((ra) =>
    ra.hazards.map((h) => ({
      raVersionId: ra.raVersionId,
      raTitle: ra.title,
      hazardIndex: h.index,
      hazard: h.hazard,
    })),
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <div className="mb-4">
        <Link
          href={`/${locale}/rams/${packId}`}
          className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t('builder.backToPack')}
        </Link>
      </div>

      <header className="mb-5">
        <h1 className="text-2xl font-semibold">{pack.title}</h1>
        <p className="text-muted-foreground text-sm">
          {pack.referenceNumber ?? ''}
          {saving
            ? ` · ${t('builder.saving')}`
            : savedAt !== null
              ? ` · ${t('builder.saved')}`
              : ''}
        </p>
      </header>

      {saveError !== null ? (
        <p className="mb-3 flex items-start gap-1.5 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {saveError}
        </p>
      ) : null}
      {readOnly ? (
        <p className="bg-muted mb-3 rounded-md p-3 text-sm">{t('builder.readOnly')}</p>
      ) : null}

      {/* The issue gate, live. Finding out at issue time that a high-risk
          hazard is unaddressed means the document was written wrong. */}
      {gate !== undefined && gate.unreferenced.length > 0 ? (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <p className="mb-1 font-medium">{t('gate.unreferencedTitle')}</p>
          <ul className="list-inside list-disc">
            {gate.unreferenced.map((h) => (
              <li key={`${h.raVersionId}-${h.hazardIndex}`}>
                {h.hazard}{' '}
                <span className="text-muted-foreground">
                  ({h.assessmentTitle} · {t(`band.${h.band}`)})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ── Bindings ─────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <CardContent className="py-4">
          <h2 className="mb-3 font-semibold">{t('bindings.title')}</h2>

          {boundRas.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('bindings.noRas')}</p>
          ) : (
            <ul className="mb-3 divide-y text-sm">
              {boundRas.map((ra) => (
                <li key={ra.raVersionId} className="flex flex-wrap items-center gap-2 py-2">
                  <Link2 className="h-4 w-4 shrink-0" aria-hidden />
                  <Link
                    href={`/${locale}/risk-assessments/${ra.assessmentId}`}
                    className="font-medium hover:underline"
                  >
                    {ra.title}
                  </Link>
                  <span className="text-muted-foreground">
                    {t('versionLabel', { version: ra.versionNumber })} ·{' '}
                    {t('bindings.hazardCount', { count: ra.hazards.length })}
                  </span>
                  {!readOnly ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      disabled={unbindRa.isPending}
                      onClick={() => unbindRa.mutate({ packId, assessmentId: ra.assessmentId })}
                    >
                      {t('bindings.unbind')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {!readOnly && (suggestions.data?.riskAssessments ?? []).length > 0 ? (
            <div className="mb-3">
              <p className="text-muted-foreground mb-1.5 text-sm">{t('bindings.suggested')}</p>
              <div className="flex flex-wrap gap-1.5">
                {(suggestions.data?.riskAssessments ?? []).map((s) => (
                  <Button
                    key={s.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={bindRa.isPending}
                    onClick={() => bindRa.mutate({ packId, assessmentId: s.id })}
                  >
                    <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                    {s.title}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <h3 className="mb-1.5 text-sm font-medium">{t('bindings.coshh')}</h3>
          {boundCoshh.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('bindings.noCoshh')}</p>
          ) : (
            <ul className="mb-3 divide-y text-sm">
              {boundCoshh.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-medium">{c.substanceName ?? c.taskDescription}</span>
                  <span className="text-muted-foreground">{c.referenceNumber ?? ''}</span>
                  {!readOnly ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      disabled={unbindCoshh.isPending}
                      onClick={() =>
                        unbindCoshh.mutate({ packId, coshhAssessmentId: c.coshhAssessmentId })
                      }
                    >
                      {t('bindings.unbind')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {!readOnly && (suggestions.data?.coshh ?? []).length > 0 ? (
            <div>
              <p className="text-muted-foreground mb-1.5 text-sm">{t('bindings.suggestedCoshh')}</p>
              <div className="flex flex-wrap gap-1.5">
                {(suggestions.data?.coshh ?? []).map((s) => (
                  <Button
                    key={s.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={bindCoshh.isPending}
                    onClick={() => bindCoshh.mutate({ packId, coshhAssessmentId: s.id })}
                  >
                    <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                    {s.substanceName ?? s.taskDescription}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Scope ────────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <CardContent className="py-4">
          <Label htmlFor="pack-scope">{t('editor.scopeLabel')}</Label>
          <Textarea
            id="pack-scope"
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

      {/* ── Steps ────────────────────────────────────────────────────── */}
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
                      {step.hazardRefs.length > 0 ? (
                        <span className="bg-muted rounded-full px-2 py-0.5 text-xs">
                          {t('bindings.hazardCount', { count: step.hazardRefs.length })}
                        </span>
                      ) : null}
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

                        {/* ADR 0015: a step REFERENCES a bound hazard. The
                            author has to be able to see them to do that. */}
                        <fieldset>
                          <legend className="text-sm font-medium">
                            {t('steps.hazardsAddressed')}
                          </legend>
                          {allHazards.length === 0 ? (
                            <p className="text-muted-foreground mt-1.5 text-sm">
                              {t('steps.noHazardsBound')}
                            </p>
                          ) : (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {allHazards.map((h) => {
                                const on = step.hazardRefs.some(
                                  (r) =>
                                    r.raVersionId === h.raVersionId &&
                                    r.hazardIndex === h.hazardIndex,
                                );
                                return (
                                  <button
                                    key={`${h.raVersionId}-${h.hazardIndex}`}
                                    type="button"
                                    disabled={readOnly}
                                    aria-pressed={on}
                                    title={h.raTitle}
                                    className={`rounded-full border px-2.5 py-1 text-xs ${
                                      on ? 'bg-foreground text-background' : 'hover:bg-muted'
                                    }`}
                                    onClick={() =>
                                      toggleHazardRef(step.id, {
                                        raVersionId: h.raVersionId,
                                        hazardIndex: h.hazardIndex,
                                        hazardLabel: h.hazard,
                                      })
                                    }
                                  >
                                    {h.hazard}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </fieldset>

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

      {/* ── Emergency ────────────────────────────────────────────────── */}
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

      {/* ── Logistics ────────────────────────────────────────────────── */}
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

      <div className="flex justify-end">
        <Button asChild variant="outline">
          <Link href={`/${locale}/rams/${packId}`}>{t('builder.backToPack')}</Link>
        </Button>
      </div>
    </main>
  );
}
