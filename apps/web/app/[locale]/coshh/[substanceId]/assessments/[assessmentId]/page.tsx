'use client';

/**
 * COSHH assessment editor.
 *
 * Structured the way the regulation reads: the exposure picture (routes,
 * people, quantity/frequency/duration), then controls laid out down the
 * hierarchy — substitution before engineering before RPE — then the
 * plain-language summary for the people doing the task.
 *
 * The hierarchy is structural, not advisory: publish refuses RPE/PPE-only
 * control sets without a justification, and a carcinogen/mutagen substance
 * cannot go active while substitution is still unconsidered (the banner
 * links back to the substance record to resolve it).
 *
 * AI assists (suggest controls / draft summary) return drafts the assessor
 * accepts item by item — the deterministic tRPC layer stays the only
 * write path.
 */
import { AlertTriangle, FileCheck2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import type { CoshhRecommendation } from '../../../../../../src/server/coshh-ai';
import { AssessmentStatusChip } from '../../../../../../src/components/coshh/chips';
import { Button } from '../../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../../src/components/ui/dialog';
import { Input } from '../../../../../../src/components/ui/input';
import { Label } from '../../../../../../src/components/ui/label';
import { Skeleton } from '../../../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../../../src/lib/permissions-context';
import { trpc } from '../../../../../../src/lib/trpc/client';
import { useServerErrorToast } from '../../../../../../src/lib/use-server-error';
import { formatDate, formatDateTime } from '../../../../../../src/lib/format-date';

const ROUTES = ['inhalation', 'skin', 'eyes', 'ingestion', 'injection'] as const;
const EXPOSED_PRESETS = [
  'employees',
  'cleaners',
  'contractors',
  'maintenance_staff',
  'young_persons',
  'new_expectant_mothers',
  'visitors',
  'members_of_public',
] as const;
const QUANTITY_BANDS = ['small', 'medium', 'large'] as const;
const FREQUENCY_BANDS = ['rare', 'monthly', 'weekly', 'daily', 'continuous'] as const;
const DURATION_BANDS = ['under_15_min', '15_60_min', '1_4_h', 'over_4_h'] as const;
const TIERS = [
  'elimination',
  'substitution',
  'engineering',
  'administrative',
  'rpe',
  'ppe',
] as const;
type Tier = (typeof TIERS)[number];

const PUBLISH_ERRORS = new Set([
  'no-routes',
  'no-controls',
  'ppe-only-needs-justification',
  'substitution-not-considered',
  'archived',
]);

export default function CoshhAssessmentPage() {
  const t = useTranslations('coshh.editor');
  const tCoshh = useTranslations('coshh');
  const locale = useLocale();
  const params = useParams<{ substanceId: string; assessmentId: string }>();
  const { substanceId, assessmentId } = params;
  const canManage = useHasPermission('coshh.manage');

  const utils = trpc.useUtils();
  const query = trpc.coshh.substances.get.useQuery({ substanceId });

  const refresh = (): void => {
    void utils.coshh.substances.get.invalidate({ substanceId });
  };
  const onError = useServerErrorToast(tCoshh('saveError'));

  const update = trpc.coshh.assessments.update.useMutation({ onSuccess: refresh, onError });
  const addControl = trpc.coshh.assessments.addControl.useMutation({
    onSuccess: refresh,
    onError,
  });
  const updateControl = trpc.coshh.assessments.updateControl.useMutation({
    onSuccess: refresh,
    onError,
  });
  const removeControl = trpc.coshh.assessments.removeControl.useMutation({
    onSuccess: refresh,
    onError,
  });
  const publish = trpc.coshh.assessments.publish.useMutation({
    onSuccess: (res) => {
      toast.success(t('publishedToast'));
      if (res.actionsCreated > 0) {
        toast.success(t('actionsCreated', { count: res.actionsCreated }));
      }
      refresh();
    },
    onError: (err) => {
      const key = PUBLISH_ERRORS.has(err.message) ? err.message : 'generic';
      toast.error(t(`publishErrors.${key}` as never));
    },
  });
  const moveToDraft = trpc.coshh.assessments.moveToDraft.useMutation({
    onSuccess: refresh,
    onError,
  });
  const recordReview = trpc.coshh.assessments.recordReview.useMutation({
    onSuccess: () => {
      toast.success(t('reviewRecordedToast'));
      refresh();
    },
    onError,
  });

  const [customGroup, setCustomGroup] = useState('');
  const [signOffOpen, setSignOffOpen] = useState(false);
  const [emergencyDraft, setEmergencyDraft] = useState<string | null>(null);
  const [summaryDraft, setSummaryDraft] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [showReview, setShowReview] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  /**
   * Seconds the suggestion has been running. Forty-nine seconds of the
   * single word "Thinking…" is indistinguishable from a hang — a
   * reviewer only waited because they were testing, and said they would
   * have reloaded at twenty and concluded the feature was broken. The
   * output is good enough to be worth waiting for; the UI has to say so.
   */
  const [suggestElapsed, setSuggestElapsed] = useState(0);
  const [suggestions, setSuggestions] = useState<CoshhRecommendation | null>(null);
  const [drafting, setDrafting] = useState(false);

  const data = query.data;
  const assessment = data?.assessments.find((a) => a.id === assessmentId);
  // BUG-02: this page finds its record inside a `substances.get` that the
  // substance page has usually already cached. An assessment created a
  // moment ago is not in that copy, so an absent record and a stale cache
  // looked identical — and the page reported the freshly-saved assessment
  // as missing, which reads as data loss. A cache still being refetched is
  // not evidence of absence: keep showing the skeleton until the query has
  // actually settled, and only then say it is not there.
  if (query.isLoading || (assessment === undefined && query.isFetching)) {
    return (
      <div className="mx-auto max-w-4xl space-y-3 px-4 py-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (data === undefined || assessment === undefined) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 text-center text-sm text-muted-foreground">
        {tCoshh('notFound')}
      </div>
    );
  }
  const { substance } = data;
  const editable = canManage && assessment.archivedAt === null;
  const substitutionUnresolved =
    (substance.isCarcinogen || substance.isMutagen) &&
    substance.substitutionStatus === 'not_assessed';
  // C-15: an active assessment edited after its last publish is stale for
  // the crew who saw the published version — prompt republish + re-share.
  const needsRepublish =
    assessment.status === 'active' &&
    assessment.lastPublishedAt !== null &&
    new Date(assessment.updatedAt) > new Date(assessment.lastPublishedAt);

  function patch(fields: Record<string, unknown>): void {
    update.mutate({ assessmentId, ...fields } as never);
  }

  function toggleRoute(route: string): void {
    const current = assessment?.routesOfExposure ?? [];
    const next = current.includes(route as never)
      ? current.filter((r) => r !== route)
      : [...current, route];
    patch({ routesOfExposure: next });
  }

  function toggleGroup(group: string): void {
    const current = assessment?.personsExposed ?? [];
    const next = current.includes(group) ? current.filter((g) => g !== group) : [...current, group];
    patch({ personsExposed: next });
  }

  async function suggestControls(): Promise<void> {
    setSuggesting(true);
    setSuggestElapsed(0);
    const started = Date.now();
    const tick = setInterval(() => {
      setSuggestElapsed(Math.round((Date.now() - started) / 1000));
    }, 1000);
    try {
      const res = await fetch('/api/ai/coshh-recommend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assessmentId }),
      });
      if (!res.ok) {
        toast.error(t('ai.suggestError'));
        return;
      }
      const body = (await res.json()) as { recommendation: CoshhRecommendation };
      setSuggestions(body.recommendation);
    } finally {
      clearInterval(tick);
      setSuggesting(false);
    }
  }

  async function draftSummary(): Promise<void> {
    setDrafting(true);
    try {
      const res = await fetch('/api/ai/coshh-summary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assessmentId, locale }),
      });
      if (!res.ok) {
        toast.error(t('ai.summaryError'));
        return;
      }
      const body = (await res.json()) as { summary: string };
      setSummaryDraft(body.summary);
      toast.success(t('ai.summaryDrafted'));
    } finally {
      setDrafting(false);
    }
  }

  const controlsByTier = new Map<Tier, typeof assessment.controls>(
    TIERS.map((tier) => [tier, assessment.controls.filter((c) => c.tier === tier)]),
  );
  const allPpeOnly =
    assessment.controls.length > 0 &&
    assessment.controls.every((c) => c.tier === 'rpe' || c.tier === 'ppe');

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/${locale}/coshh/${substanceId}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← {substance.name}
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            <span className="font-mono text-sm text-muted-foreground">
              {assessment.referenceNumber}
            </span>
            <AssessmentStatusChip status={assessment.status} />
            {assessment.kind === 'point_of_work' ? (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                {tCoshh('kinds.point_of_work')}
              </span>
            ) : null}
          </h1>
        </div>
        {editable ? (
          <div className="flex items-center gap-2">
            {assessment.status === 'active' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => moveToDraft.mutate({ assessmentId })}
              >
                {t('moveToDraft')}
              </Button>
            ) : null}
            <Button size="sm" disabled={publish.isPending} onClick={() => setSignOffOpen(true)}>
              {assessment.status === 'active' ? t('republish') : t('publish')}
            </Button>
          </div>
        ) : null}
      </div>

      {substitutionUnresolved ? (
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1">
            {t('substitutionBlockedBanner')}{' '}
            <Link href={`/${locale}/coshh/${substanceId}`} className="underline">
              {t('substitutionBlockedLink')}
            </Link>
          </p>
        </div>
      ) : null}

      {needsRepublish ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1">{t('staleBanner')}</p>
          {editable ? (
            <Button size="sm" variant="outline" onClick={() => setSignOffOpen(true)}>
              {t('republish')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* ── Signed versions (BUG-03) ─────────────────────────────────
          Editing an Active assessment stays legal — the amber banner above
          is the point — but until now there was no copy of what had been
          signed, so an edit destroyed it. Naming the versions here is what
          makes the banner mean something: "changed since publish" is only
          useful if the published thing still exists. */}
      {assessment.versions.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 p-6">
            <h2 className="text-sm font-medium">{tCoshh('versions.title')}</h2>
            <ul className="divide-y text-sm">
              {assessment.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 py-2">
                  <FileCheck2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  <span className="font-medium">
                    {tCoshh('versions.number', { version: v.versionNumber })}
                  </span>
                  <span className="text-muted-foreground">
                    {tCoshh('versions.signedBy', {
                      name: v.signedOffByName ?? '—',
                      date: formatDateTime(v.signedOffAt, locale),
                    })}
                  </span>
                  {v.supersededAt === null ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
                      {tCoshh('versions.current')}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      {tCoshh('versions.superseded')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Task ────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-2 p-6">
          <Label htmlFor="task">{t('taskLabel')}</Label>
          <Textarea
            id="task"
            value={taskDraft ?? assessment.taskDescription}
            onChange={(e) => setTaskDraft(e.target.value)}
            onBlur={() => {
              if (taskDraft !== null && taskDraft.trim() !== assessment.taskDescription) {
                patch({ taskDescription: taskDraft.trim() });
              }
              setTaskDraft(null);
            }}
            rows={2}
            disabled={!editable}
          />
        </CardContent>
      </Card>

      {/* ── Exposure picture ────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-sm font-semibold">{t('exposureSection')}</h2>
          <div className="space-y-1.5">
            <Label>{t('routesLabel')}</Label>
            <div className="flex flex-wrap gap-2">
              {ROUTES.map((route) => {
                const active = assessment.routesOfExposure.includes(route);
                return (
                  <button
                    key={route}
                    type="button"
                    disabled={!editable}
                    onClick={() => toggleRoute(route)}
                    className={`rounded-md border px-2.5 py-1 text-sm transition-colors ${
                      active
                        ? 'border-primary bg-primary/10 font-medium text-primary'
                        : 'border-input bg-background text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    {tCoshh(`routes.${route}` as never)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('personsLabel')}</Label>
            <div className="flex flex-wrap gap-2">
              {EXPOSED_PRESETS.map((group) => {
                const active = assessment.personsExposed.includes(group);
                return (
                  <button
                    key={group}
                    type="button"
                    disabled={!editable}
                    onClick={() => toggleGroup(group)}
                    className={`rounded-md border px-2.5 py-1 text-sm transition-colors ${
                      active
                        ? 'border-primary bg-primary/10 font-medium text-primary'
                        : 'border-input bg-background text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    {tCoshh(`exposedGroups.${group}` as never)}
                  </button>
                );
              })}
              {assessment.personsExposed
                .filter((g) => !(EXPOSED_PRESETS as readonly string[]).includes(g))
                .map((g) => (
                  <button
                    key={g}
                    type="button"
                    disabled={!editable}
                    onClick={() => toggleGroup(g)}
                    className="rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary"
                  >
                    {g} ×
                  </button>
                ))}
              {editable ? (
                <Input
                  value={customGroup}
                  onChange={(e) => setCustomGroup(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customGroup.trim() !== '') {
                      e.preventDefault();
                      toggleGroup(customGroup.trim());
                      setCustomGroup('');
                    }
                  }}
                  placeholder={t('personsCustomPlaceholder')}
                  className="h-8 w-40"
                />
              ) : null}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="personsCount">{t('personsCountLabel')}</Label>
              <Input
                id="personsCount"
                type="number"
                min="0"
                defaultValue={assessment.personsCount ?? ''}
                onBlur={(e) =>
                  patch({ personsCount: e.target.value === '' ? null : Number(e.target.value) })
                }
                disabled={!editable}
              />
            </div>
            <BandSelect
              id="quantityBand"
              label={t('quantityBandLabel')}
              value={assessment.quantityBand}
              options={QUANTITY_BANDS}
              nsPrefix="quantityBands"
              disabled={!editable}
              onChange={(v) => patch({ quantityBand: v })}
            />
            <BandSelect
              id="frequencyBand"
              label={t('frequencyBandLabel')}
              value={assessment.frequencyBand}
              options={FREQUENCY_BANDS}
              nsPrefix="frequencyBands"
              disabled={!editable}
              onChange={(v) => patch({ frequencyBand: v })}
            />
            <BandSelect
              id="durationBand"
              label={t('durationBandLabel')}
              value={assessment.durationBand}
              options={DURATION_BANDS}
              nsPrefix="durationBands"
              disabled={!editable}
              onChange={(v) => patch({ durationBand: v })}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Controls: the hierarchy ─────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">{t('controlsSection')}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('controlsHint')}</p>
            </div>
            {editable ? (
              <Button
                size="sm"
                variant="outline"
                disabled={suggesting}
                onClick={() => void suggestControls()}
              >
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                {suggesting
                  ? t('ai.suggestingElapsed', { seconds: suggestElapsed })
                  : t('ai.suggestButton')}
              </Button>
            ) : null}
          </div>

          {suggestions !== null ? (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{t('ai.suggestionsTitle')}</p>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:underline"
                  onClick={() => setSuggestions(null)}
                >
                  {t('ai.dismiss')}
                </button>
              </div>
              {suggestions.substitutionSuggestion !== '' ? (
                <p className="text-xs">
                  <span className="font-medium">{t('ai.substitutionIdea')}:</span>{' '}
                  {suggestions.substitutionSuggestion}
                </p>
              ) : null}
              <ul className="space-y-1.5">
                {suggestions.controls.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">
                      {tCoshh(`tiers.${s.tier}` as never)}
                    </span>
                    <span className="min-w-0 flex-1">
                      {s.description}
                      {s.rationale !== '' ? (
                        <span className="block text-xs text-muted-foreground">{s.rationale}</span>
                      ) : null}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-xs"
                      disabled={addControl.isPending}
                      onClick={() => {
                        addControl.mutate({
                          assessmentId,
                          tier: s.tier,
                          description: s.description,
                          status: 'planned',
                        });
                        setSuggestions({
                          ...suggestions,
                          controls: suggestions.controls.filter((_, j) => j !== i),
                        });
                      }}
                    >
                      {t('ai.accept')}
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">{t('ai.acceptHint')}</p>
            </div>
          ) : null}

          {allPpeOnly ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              {t('ppeOnlyWarning')}
            </div>
          ) : null}

          <div className="space-y-4">
            {TIERS.map((tier) => (
              <TierGroup
                key={tier}
                tier={tier}
                controls={controlsByTier.get(tier) ?? []}
                editable={editable}
                needsJustification={allPpeOnly && (tier === 'rpe' || tier === 'ppe')}
                onAdd={(description) =>
                  addControl.mutate({ assessmentId, tier, description, status: 'in_place' })
                }
                onToggleStatus={(control) =>
                  updateControl.mutate({
                    controlId: control.id,
                    status: control.status === 'planned' ? 'in_place' : 'planned',
                  })
                }
                onJustify={(control, justification) =>
                  updateControl.mutate({ controlId: control.id, ppeJustification: justification })
                }
                onRemove={(control) => removeControl.mutate({ controlId: control.id })}
                onRpeDetail={(control, d) =>
                  updateControl.mutate({
                    controlId: control.id,
                    rpeType: d.rpeType,
                    rpeApf: d.rpeApf,
                    faceFitConfirmedAt: d.faceFitConfirmedAt,
                  })
                }
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Requirements & emergency ────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-sm font-semibold">{t('requirementsSection')}</h2>
          <div className="flex flex-wrap gap-4 text-sm">
            {(
              [
                ['levRequired', assessment.levRequired, suggestions?.levRecommended],
                [
                  'healthSurveillanceRequired',
                  assessment.healthSurveillanceRequired,
                  suggestions?.healthSurveillanceRecommended,
                ],
                [
                  'exposureMonitoringRequired',
                  assessment.exposureMonitoringRequired,
                  suggestions?.exposureMonitoringRecommended,
                ],
              ] as const
            ).map(([key, value, suggested]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={value}
                  disabled={!editable}
                  onChange={(e) => patch({ [key]: e.target.checked })}
                  className="h-4 w-4"
                />
                {t(`requirements.${key}` as never)}
                {suggested === true && !value ? (
                  <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 py-0.5 text-[11px] text-primary">
                    <Sparkles className="h-2.5 w-2.5" />
                    {t('ai.suggestedChip')}
                  </span>
                ) : null}
              </label>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emergency">{t('emergencyLabel')}</Label>
            <Textarea
              id="emergency"
              value={emergencyDraft ?? assessment.emergencyNotes}
              onChange={(e) => setEmergencyDraft(e.target.value)}
              onBlur={() => {
                if (emergencyDraft !== null && emergencyDraft !== assessment.emergencyNotes) {
                  patch({ emergencyNotes: emergencyDraft });
                }
                setEmergencyDraft(null);
              }}
              rows={2}
              disabled={!editable}
              placeholder={t('emergencyPlaceholder')}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Plain-language summary ──────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">{t('summarySection')}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('summaryHint')}</p>
            </div>
            {editable ? (
              <Button
                size="sm"
                variant="outline"
                disabled={drafting}
                onClick={() => void draftSummary()}
              >
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                {drafting ? t('ai.drafting') : t('ai.draftSummaryButton')}
              </Button>
            ) : null}
          </div>
          <Textarea
            value={summaryDraft ?? assessment.plainSummary}
            onChange={(e) => setSummaryDraft(e.target.value)}
            rows={6}
            disabled={!editable}
            placeholder={t('summaryPlaceholder')}
          />
          {summaryDraft !== null && summaryDraft !== assessment.plainSummary && editable ? (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSummaryDraft(null)}>
                {t('summaryDiscard')}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  patch({ plainSummary: summaryDraft });
                  setSummaryDraft(null);
                }}
              >
                {t('summarySave')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Review ──────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">{t('reviewSection')}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('reviewLine', {
                  last:
                    assessment.lastReviewedAt !== null
                      ? new Date(assessment.lastReviewedAt).toLocaleDateString(locale)
                      : '—',
                  next:
                    assessment.nextReviewAt !== null
                      ? new Date(assessment.nextReviewAt).toLocaleDateString(locale)
                      : '—',
                })}
              </p>
            </div>
            {editable ? (
              <Button size="sm" variant="outline" onClick={() => setShowReview((v) => !v)}>
                {t('recordReviewButton')}
              </Button>
            ) : null}
          </div>
          {showReview ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="reviewNote">{t('reviewNoteLabel')}</Label>
                <Input
                  id="reviewNote"
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder={t('reviewNotePlaceholder')}
                />
              </div>
              <Button
                size="sm"
                disabled={recordReview.isPending}
                onClick={() => {
                  recordReview.mutate({ assessmentId, note: reviewNote });
                  setReviewNote('');
                  setShowReview(false);
                }}
              >
                {t('reviewSaveButton')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {editable ? (
        <div className="flex justify-end">
          <Button disabled={publish.isPending} onClick={() => setSignOffOpen(true)}>
            {assessment.status === 'active' ? t('republish') : t('publish')}
          </Button>
        </div>
      ) : null}

      {/* Assessor sign-off (C-21): every publish carries the attestation. */}
      <Dialog open={signOffOpen} onOpenChange={setSignOffOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('signOff.title')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{t('signOff.statement')}</p>
          <p className="text-xs text-muted-foreground">{t('signOff.hint')}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSignOffOpen(false)}>
              {t('signOff.cancel')}
            </Button>
            <Button
              type="button"
              disabled={publish.isPending}
              onClick={() => {
                setSignOffOpen(false);
                publish.mutate({ assessmentId });
              }}
            >
              {t('signOff.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BandSelect({
  id,
  label,
  value,
  options,
  nsPrefix,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  options: ReadonlyArray<string>;
  nsPrefix: string;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  const tCoshh = useTranslations('coshh');
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {tCoshh(`${nsPrefix}.${o}` as never)}
          </option>
        ))}
      </select>
    </div>
  );
}

interface ControlRow {
  id: string;
  tier: string;
  description: string;
  status: string;
  ppeJustification: string | null;
  rpeType: string | null;
  rpeApf: number | null;
  faceFitConfirmedAt: Date | null;
  actionId: string | null;
}

/** RPE detail patch (C-8): type, assigned protection factor, face-fit date. */
interface RpeDetail {
  rpeType: string | null;
  rpeApf: number | null;
  faceFitConfirmedAt: Date | null;
}

function TierGroup({
  tier,
  controls,
  editable,
  needsJustification,
  onAdd,
  onToggleStatus,
  onJustify,
  onRemove,
  onRpeDetail,
}: {
  tier: Tier;
  controls: ReadonlyArray<ControlRow>;
  editable: boolean;
  needsJustification: boolean;
  onAdd: (description: string) => void;
  onToggleStatus: (control: ControlRow) => void;
  onJustify: (control: ControlRow, justification: string) => void;
  onRemove: (control: ControlRow) => void;
  onRpeDetail: (control: ControlRow, detail: RpeDetail) => void;
}) {
  const t = useTranslations('coshh.editor');
  const tCoshh = useTranslations('coshh');
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [justifying, setJustifying] = useState<string | null>(null);
  const [justificationText, setJustificationText] = useState('');
  const [rpeEditing, setRpeEditing] = useState<string | null>(null);
  const [rpeTypeDraft, setRpeTypeDraft] = useState('');
  const [rpeApfDraft, setRpeApfDraft] = useState('');
  const [rpeFitDraft, setRpeFitDraft] = useState('');

  function startRpeEdit(c: ControlRow): void {
    setRpeEditing(c.id);
    setRpeTypeDraft(c.rpeType ?? '');
    setRpeApfDraft(c.rpeApf !== null ? String(c.rpeApf) : '');
    setRpeFitDraft(
      c.faceFitConfirmedAt !== null
        ? new Date(c.faceFitConfirmedAt).toISOString().slice(0, 10)
        : '',
    );
  }

  function saveRpeEdit(c: ControlRow): void {
    onRpeDetail(c, {
      rpeType: rpeTypeDraft.trim() === '' ? null : rpeTypeDraft.trim(),
      rpeApf: rpeApfDraft !== '' && Number(rpeApfDraft) >= 1 ? Number(rpeApfDraft) : null,
      faceFitConfirmedAt: rpeFitDraft === '' ? null : new Date(`${rpeFitDraft}T00:00:00.000Z`),
    });
    setRpeEditing(null);
  }

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
        <div className="min-w-0">
          <span className="text-sm font-medium">{tCoshh(`tiers.${tier}` as never)}</span>
          <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
            {t(`tierHints.${tier}` as never)}
          </span>
        </div>
        {editable ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setAdding((v) => !v)}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      <div className="divide-y">
        {controls.length === 0 && !adding ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{t('tierEmpty')}</p>
        ) : (
          controls.map((c) => (
            <div key={c.id} className="space-y-1.5 px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">{c.description}</span>
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => onToggleStatus(c)}
                  className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium ${
                    c.status === 'planned'
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100'
                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100'
                  }`}
                  title={t('toggleStatusHint')}
                >
                  {c.status === 'planned' ? t('controlPlanned') : t('controlInPlace')}
                </button>
                {editable ? (
                  <button
                    type="button"
                    aria-label={t('removeControl')}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemove(c)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              {(tier === 'rpe' || tier === 'ppe') && needsJustification ? (
                c.ppeJustification !== null && c.ppeJustification.trim() !== '' ? (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">{t('justificationLabel')}:</span>{' '}
                    {c.ppeJustification}
                  </p>
                ) : justifying === c.id ? (
                  <div className="flex items-end gap-2">
                    <Textarea
                      value={justificationText}
                      onChange={(e) => setJustificationText(e.target.value)}
                      rows={2}
                      className="text-xs"
                      placeholder={t('justificationPlaceholder')}
                    />
                    <Button
                      size="sm"
                      disabled={justificationText.trim() === ''}
                      onClick={() => {
                        onJustify(c, justificationText.trim());
                        setJustifying(null);
                        setJustificationText('');
                      }}
                    >
                      {t('justificationSave')}
                    </Button>
                  </div>
                ) : editable ? (
                  <button
                    type="button"
                    className="text-xs text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
                    onClick={() => setJustifying(c.id)}
                  >
                    {t('justificationNeeded')}
                  </button>
                ) : null
              ) : null}
              {tier === 'rpe' ? (
                rpeEditing === c.id ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <Input
                      value={rpeTypeDraft}
                      onChange={(e) => setRpeTypeDraft(e.target.value)}
                      placeholder={t('rpe.typePlaceholder')}
                      className="h-8 w-44 text-xs"
                    />
                    <Input
                      type="number"
                      min={1}
                      value={rpeApfDraft}
                      onChange={(e) => setRpeApfDraft(e.target.value)}
                      placeholder={t('rpe.apfPlaceholder')}
                      className="h-8 w-24 text-xs"
                    />
                    <Input
                      type="date"
                      value={rpeFitDraft}
                      onChange={(e) => setRpeFitDraft(e.target.value)}
                      aria-label={t('rpe.faceFitLabel')}
                      className="h-8 w-40 text-xs"
                    />
                    <Button size="sm" onClick={() => saveRpeEdit(c)}>
                      {t('rpe.save')}
                    </Button>
                  </div>
                ) : c.rpeType !== null || c.rpeApf !== null || c.faceFitConfirmedAt !== null ? (
                  <p className="text-xs text-muted-foreground">
                    {[
                      ...(c.rpeType !== null ? [c.rpeType] : []),
                      ...(c.rpeApf !== null ? [t('rpe.apfValue', { apf: c.rpeApf })] : []),
                      ...(c.faceFitConfirmedAt !== null
                        ? [
                            t('rpe.faceFitValue', {
                              date: formatDate(c.faceFitConfirmedAt),
                            }),
                          ]
                        : []),
                    ].join(' · ')}
                    {editable ? (
                      <button
                        type="button"
                        className="ml-2 underline-offset-2 hover:underline"
                        onClick={() => startRpeEdit(c)}
                      >
                        {t('rpe.edit')}
                      </button>
                    ) : null}
                  </p>
                ) : editable ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => startRpeEdit(c)}
                  >
                    {t('rpe.addDetail')}
                  </button>
                ) : null
              ) : null}
            </div>
          ))
        )}
        {adding ? (
          <div className="flex items-center gap-2 px-3 py-2">
            <Input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && text.trim() !== '') {
                  e.preventDefault();
                  onAdd(text.trim());
                  setText('');
                  setAdding(false);
                }
              }}
              placeholder={t('addControlPlaceholder')}
              className="h-8"
            />
            <Button
              size="sm"
              disabled={text.trim() === ''}
              onClick={() => {
                onAdd(text.trim());
                setText('');
                setAdding(false);
              }}
            >
              {t('addControlSave')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
