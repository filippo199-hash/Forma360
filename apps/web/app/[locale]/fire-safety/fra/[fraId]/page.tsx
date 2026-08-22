'use client';

/**
 * Fire risk assessment editor — reviewable rather than rewritable.
 *
 * Draft: the assessor works through the recognised structure (sources
 * of ignition / fuel / oxygen, people at risk, evaluation, significant
 * findings, taken-together rating). Publish attests it as suitable and
 * sufficient — requires the rating, the named Responsible Person, and
 * recorded findings (or an explicit "none significant" confirmation) —
 * and generates one action per finding needing remedial work. Active:
 * reviews append to the immutable log with the trigger that prompted
 * them; every content edit is event-logged. Archived: read-only.
 */
import {
  FRA_FINDING_CATEGORIES,
  FRA_FINDING_PRIORITIES,
  FRA_METHODOLOGIES,
  FRA_PERSONS_AT_RISK_PRESETS,
  FRA_RISK_RATINGS,
  suggestedFraReviewMonths,
} from '@forma360/shared/fire-safety';
import { Archive, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FraStatusChip, RiskRatingChip } from '../../../../../src/components/fire-safety/chips';
import { Button } from '../../../../../src/components/ui/button';
import { appConfirm } from '../../../../../src/components/ui/app-confirm';
import { Checkbox } from '../../../../../src/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../src/components/ui/dialog';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import { Input } from '../../../../../src/components/ui/input';
import { Label } from '../../../../../src/components/ui/label';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../../src/components/ui/textarea';
import { TooltipIconButton } from '../../../../../src/components/ui/tooltip-icon-button';
import { UserPicker } from '../../../../../src/components/selectors/user-picker';
import { useHasPermission } from '../../../../../src/lib/permissions-context';
import { trpc } from '../../../../../src/lib/trpc/client';
// UK-DATES: a local toLocaleDateString(locale) helper shadowed the shared
// one and printed US-style dates ('en' resolves to en-US in ICU).
import { formatDate } from '../../../../../src/lib/format-date';
import { useServerErrorToast } from '../../../../../src/lib/use-server-error';

const PUBLISH_ERROR_KEYS: Record<string, string> = {
  'no-risk-rating': 'publishErrors.noRiskRating',
  'no-responsible-person': 'publishErrors.noResponsiblePerson',
  'no-findings': 'publishErrors.noFindings',
  'no-persons-at-risk': 'publishErrors.noPersonsAtRisk',
  'no-ignition-sources': 'publishErrors.noIgnitionSources',
  'no-fuel-sources': 'publishErrors.noFuelSources',
  'no-oxygen-sources': 'publishErrors.noOxygenSources',
  'no-evaluation': 'publishErrors.noEvaluation',
  'intolerable-needs-action': 'publishErrors.intolerableNeedsAction',
};

export default function FraEditorPage() {
  const t = useTranslations('fireSafety.fra');
  const tShared = useTranslations('fireSafety');
  const onServerErrorG0 = useServerErrorToast(tShared('saveError'));
  const onServerErrorG0_1 = useServerErrorToast(t('raiseAction.error'));
  const params = useParams<{ locale: string; fraId: string }>();
  const locale = params.locale ?? 'en';
  const fraId = params.fraId ?? '';
  const router = useRouter();
  const utils = trpc.useUtils();

  const canEdit = useHasPermission('fireSafety.create');
  const canManage = useHasPermission('fireSafety.manage');

  const {
    data: fra,
    isLoading,
    error,
  } = trpc.fireSafety.fras.get.useQuery({ fraId }, { enabled: fraId.length > 0 });

  function invalidate(): void {
    void utils.fireSafety.fras.get.invalidate({ fraId });
    void utils.fireSafety.fras.list.invalidate();
    void utils.fireSafety.overview.invalidate();
  }

  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);

  const updateFra = trpc.fireSafety.fras.update.useMutation({
    onSuccess: () => {
      toast.success(t('savedToast'));
      setDraft(null);
      invalidate();
    },
    onError: onServerErrorG0,
  });
  // FS-9: publish is a signed act — it always goes through the sign-off
  // dialog so the RP sees the words they are attesting and the actions
  // the publish will raise.
  const [signOffOpen, setSignOffOpen] = useState(false);
  const [signOffChecked, setSignOffChecked] = useState(false);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseTitle, setRaiseTitle] = useState('');
  const [raiseDescription, setRaiseDescription] = useState('');
  const [raisePriority, setRaisePriority] = useState<'low' | 'medium' | 'high' | 'critical'>(
    'medium',
  );
  const [raiseAssignee, setRaiseAssignee] = useState<{
    userId: string | null;
    name: string;
  } | null>(null);
  const [raiseDue, setRaiseDue] = useState('');
  const raiseAction = trpc.fireSafety.fras.raiseAction.useMutation({
    onSuccess: () => {
      toast.success(t('raiseAction.success'));
      setRaiseOpen(false);
      setRaiseTitle('');
      setRaiseDescription('');
      setRaiseAssignee(null);
      setRaiseDue('');
    },
    onError: onServerErrorG0_1,
  });
  const publishFra = trpc.fireSafety.fras.publish.useMutation({
    onSuccess: (result) => {
      setSignOffOpen(false);
      setSignOffChecked(false);
      toast.success(
        result.actionsCreated > 0
          ? t('publishedWithActionsToast', { count: result.actionsCreated })
          : t('publishedToast'),
      );
      invalidate();
    },
    onError: (err) => {
      setSignOffOpen(false);
      setSignOffChecked(false);
      const key = PUBLISH_ERROR_KEYS[err.message];
      toast.error(key !== undefined ? t(key as never) : tShared('saveError'));
    },
  });
  const moveToDraft = trpc.fireSafety.fras.moveToDraft.useMutation({
    onSuccess: () => invalidate(),
    onError: onServerErrorG0,
  });
  const archiveFra = trpc.fireSafety.fras.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archivedToast'));
      router.push(`/${locale}/fire-safety`);
    },
    onError: onServerErrorG0,
  });

  // Findings
  const [findingCategory, setFindingCategory] = useState<string>('means_of_escape');
  const [findingPriority, setFindingPriority] = useState<string>('medium');
  const [findingDescription, setFindingDescription] = useState('');
  const [findingRequiresAction, setFindingRequiresAction] = useState(true);

  const addFinding = trpc.fireSafety.fras.addFinding.useMutation({
    onSuccess: () => {
      setFindingDescription('');
      invalidate();
    },
    onError: onServerErrorG0,
  });
  const resolveFinding = trpc.fireSafety.fras.resolveFinding.useMutation({
    onSuccess: () => invalidate(),
    onError: onServerErrorG0,
  });
  const removeFinding = trpc.fireSafety.fras.removeFinding.useMutation({
    onSuccess: () => invalidate(),
    onError: (err) =>
      toast.error(err.message === 'has-action' ? t('findingHasAction') : tShared('saveError')),
  });

  // Reviews
  const [reviewTrigger, setReviewTrigger] = useState<string>('scheduled');
  const [reviewOutcome, setReviewOutcome] = useState<string>('confirmed');
  const [reviewNote, setReviewNote] = useState('');

  const recordReview = trpc.fireSafety.fras.recordReview.useMutation({
    onSuccess: () => {
      toast.success(t('reviewRecordedToast'));
      setReviewNote('');
      invalidate();
    },
    onError: onServerErrorG0,
  });

  if (isLoading) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }
  if (error !== null || fra === undefined) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <p className="text-sm text-muted-foreground">{tShared('notFound')}</p>
        <Link className="text-sm underline" href={`/${locale}/fire-safety`}>
          {tShared('backToList')}
        </Link>
      </main>
    );
  }

  const archived = fra.status === 'archived';
  const editable = canEdit && !archived;

  const value = (key: string): unknown =>
    draft !== null && key in draft ? draft[key] : (fra as Record<string, unknown>)[key];
  const stringValue = (key: string): string => String(value(key) ?? '');
  const setField = (key: string, v: unknown): void => setDraft({ ...(draft ?? {}), [key]: v });

  const personsAtRisk = (value('personsAtRisk') as string[] | undefined) ?? [];
  function togglePersons(group: string): void {
    setField(
      'personsAtRisk',
      personsAtRisk.includes(group)
        ? personsAtRisk.filter((g) => g !== group)
        : [...personsAtRisk, group],
    );
  }

  function save(): void {
    if (draft === null) return;
    updateFra.mutate({
      fraId,
      ...(draft['title'] !== undefined ? { title: String(draft['title']) } : {}),
      ...(draft['methodology'] !== undefined ? { methodology: draft['methodology'] as never } : {}),
      ...(draft['responsiblePersonName'] !== undefined
        ? { responsiblePersonName: String(draft['responsiblePersonName']) }
        : {}),
      ...(draft['assessorUserId'] !== undefined
        ? // Only ever written by the assessor picker as string | null.
          { assessorUserId: draft['assessorUserId'] as string | null }
        : {}),
      ...(draft['assessorName'] !== undefined
        ? { assessorName: String(draft['assessorName']) }
        : {}),
      ...(draft['premisesDescription'] !== undefined
        ? { premisesDescription: String(draft['premisesDescription']) }
        : {}),
      ...(draft['personsAtRisk'] !== undefined
        ? { personsAtRisk: draft['personsAtRisk'] as string[] }
        : {}),
      ...(draft['maxOccupancy'] !== undefined
        ? {
            maxOccupancy: draft['maxOccupancy'] === '' ? null : Number(draft['maxOccupancy']),
          }
        : {}),
      ...(draft['sleepingOccupants'] !== undefined
        ? { sleepingOccupants: Boolean(draft['sleepingOccupants']) }
        : {}),
      ...(draft['ignitionSources'] !== undefined
        ? { ignitionSources: String(draft['ignitionSources']) }
        : {}),
      ...(draft['fuelSources'] !== undefined ? { fuelSources: String(draft['fuelSources']) } : {}),
      ...(draft['oxygenSources'] !== undefined
        ? { oxygenSources: String(draft['oxygenSources']) }
        : {}),
      ...(draft['evaluationNotes'] !== undefined
        ? { evaluationNotes: String(draft['evaluationNotes']) }
        : {}),
      ...(draft['riskRating'] !== undefined
        ? { riskRating: (draft['riskRating'] === '' ? null : draft['riskRating']) as never }
        : {}),
      ...(draft['reviewFrequencyMonths'] !== undefined
        ? {
            reviewFrequencyMonths:
              draft['reviewFrequencyMonths'] === '' ? null : Number(draft['reviewFrequencyMonths']),
          }
        : {}),
    });
  }

  const openFindings = fra.findings.filter((f) => f.resolvedAt === null);
  const rating = (value('riskRating') ?? null) as
    | 'trivial'
    | 'tolerable'
    | 'moderate'
    | 'substantial'
    | 'intolerable'
    | null;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-1 text-sm">
        <Link className="text-muted-foreground hover:underline" href={`/${locale}/fire-safety`}>
          {tShared('backToList')}
        </Link>
      </div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{fra.referenceNumber}</span>
            <FraStatusChip status={fra.status} />
            <RiskRatingChip rating={fra.riskRating} />
          </div>
          {editable ? (
            <Input
              className="mt-1.5 max-w-xl text-lg font-semibold"
              value={stringValue('title')}
              onChange={(e) => setField('title', e.target.value)}
            />
          ) : (
            <h1 className="mt-1 text-xl font-semibold tracking-tight">{fra.title}</h1>
          )}
          {fra.building !== null ? (
            <p className="mt-1 text-sm text-muted-foreground">
              <Link className="hover:underline" href={`/${locale}/fire-safety/${fra.building.id}`}>
                {fra.building.name}
              </Link>
            </p>
          ) : null}
        </div>
        {/* Utility actions collapse to icons (ADR 0014 G1); the one primary
            act — Sign & publish — keeps its words and sits rightmost. */}
        <div className="flex flex-wrap items-center gap-2">
          {editable ? (
            <Button variant="outline" size="sm" onClick={() => setRaiseOpen(true)}>
              {t('raiseAction.button')}
            </Button>
          ) : null}
          <TooltipIconButton
            icon={Download}
            label={t('pdfButton')}
            href={`/api/exports/fra-pdf?fraId=${fraId}`}
            target="_blank"
          />
          {canManage && !archived ? (
            <TooltipIconButton
              icon={Archive}
              label={tShared('archiveButton')}
              variant="destructive"
              onClick={() => {
                void appConfirm({ description: t('archiveConfirm'), destructive: true }).then(
                  (ok) => {
                    if (ok) archiveFra.mutate({ fraId });
                  },
                );
              }}
            />
          ) : null}
          {canManage && !archived && fra.status === 'active' ? (
            <Button variant="outline" onClick={() => moveToDraft.mutate({ fraId })}>
              {t('moveToDraftButton')}
            </Button>
          ) : null}
          {canManage && !archived && fra.status === 'draft' ? (
            <Button onClick={() => setSignOffOpen(true)} disabled={publishFra.isPending}>
              {t('publishButton')}
            </Button>
          ) : null}
        </div>
      </div>

      {fra.status === 'active' && fra.nextReviewAt !== null ? (
        <p className="mb-4 text-sm text-muted-foreground">
          {t('reviewLine', {
            next: formatDate(fra.nextReviewAt, locale),
            last: formatDate(fra.lastReviewedAt ?? fra.publishedAt, locale),
          })}
        </p>
      ) : null}

      {/* FS-6: an intolerable live assessment is loud, everywhere. */}
      {fra.status === 'active' && fra.riskRating === 'intolerable' ? (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-semibold">{t('intolerableBanner.title')}</p>
          <p className="mt-0.5">{t('intolerableBanner.body')}</p>
        </div>
      ) : null}

      {/* FS-7: the signature covers the content it signed — edits since
          publish put the attestation in question until re-signed. */}
      {fra.attestationStale ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <div>
            <p className="font-semibold">{t('staleBanner.title')}</p>
            <p className="mt-0.5">
              {t('staleBanner.body', {
                name: fra.publishedByName ?? '—',
                date: formatDate(fra.publishedAt, locale),
              })}
            </p>
          </div>
          {canManage ? (
            <Button size="sm" onClick={() => setSignOffOpen(true)}>
              {t('staleBanner.reattest')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-5">
        <Card>
          <CardContent className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">{t('detailsHeading')}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fra-methodology">{t('methodology')}</Label>
                <select
                  id="fra-methodology"
                  value={stringValue('methodology')}
                  onChange={(e) => setField('methodology', e.target.value)}
                  disabled={!editable}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {FRA_METHODOLOGIES.map((m) => (
                    <option key={m} value={m}>
                      {t(`methodologies.${m}` as never)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <UserPicker
                  label={t('responsiblePerson')}
                  value={
                    stringValue('responsiblePersonName') !== ''
                      ? { userId: null, name: stringValue('responsiblePersonName') }
                      : null
                  }
                  onChange={(v) => setField('responsiblePersonName', v?.name ?? '')}
                  allowFreeText
                  disabled={!editable}
                  placeholder={t('responsiblePersonPlaceholder')}
                />
              </div>
              <div className="space-y-1.5">
                <UserPicker
                  label={t('assessorName')}
                  value={
                    stringValue('assessorName') !== ''
                      ? {
                          // DB column is text | null; draft writes match.
                          userId: (value('assessorUserId') as string | null) ?? null,
                          name: stringValue('assessorName'),
                        }
                      : null
                  }
                  onChange={(v) =>
                    // One setDraft: two setField calls would race on the
                    // same stale draft and drop one of the two keys.
                    setDraft({
                      ...(draft ?? {}),
                      assessorName: v?.name ?? '',
                      assessorUserId: v?.userId ?? null,
                    })
                  }
                  allowFreeText
                  disabled={!editable}
                  placeholder={t('assessorPlaceholder')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fra-premises">{t('premisesDescription')}</Label>
                <Input
                  id="fra-premises"
                  value={stringValue('premisesDescription')}
                  onChange={(e) => setField('premisesDescription', e.target.value)}
                  disabled={!editable}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">{t('occupancyHeading')}</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {FRA_PERSONS_AT_RISK_PRESETS.map((group) => (
                <label key={group} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={personsAtRisk.includes(group)}
                    onChange={() => togglePersons(group)}
                    disabled={!editable}
                    className="h-4 w-4"
                  />
                  {t(`personsAtRisk.${group}` as never)}
                </label>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fra-occupancy">{t('maxOccupancy')}</Label>
                <Input
                  id="fra-occupancy"
                  type="number"
                  min="0"
                  value={value('maxOccupancy') === null ? '' : String(value('maxOccupancy'))}
                  onChange={(e) => setField('maxOccupancy', e.target.value)}
                  disabled={!editable}
                />
              </div>
              <label className="mt-6 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(value('sleepingOccupants'))}
                  onChange={(e) => setField('sleepingOccupants', e.target.checked)}
                  disabled={!editable}
                  className="h-4 w-4"
                />
                {t('sleepingOccupants')}
              </label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">{t('hazardsHeading')}</h2>
            {(
              [
                ['ignitionSources', 'ignitionSources'],
                ['fuelSources', 'fuelSources'],
                ['oxygenSources', 'oxygenSources'],
                ['evaluationNotes', 'evaluationNotes'],
              ] as const
            ).map(([key, labelKey]) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`fra-${key}`}>{t(labelKey)}</Label>
                <Textarea
                  id={`fra-${key}`}
                  rows={2}
                  value={stringValue(key)}
                  onChange={(e) => setField(key, e.target.value)}
                  disabled={!editable}
                />
              </div>
            ))}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fra-rating">{t('riskRating')}</Label>
                <select
                  id="fra-rating"
                  value={rating ?? ''}
                  onChange={(e) => setField('riskRating', e.target.value)}
                  disabled={!editable}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{t('riskRatingUnset')}</option>
                  {FRA_RISK_RATINGS.map((r) => (
                    <option key={r} value={r}>
                      {tShared(`riskRatings.${r}` as never)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fra-review-months">{t('reviewMonths')}</Label>
                <Input
                  id="fra-review-months"
                  type="number"
                  min="1"
                  max="60"
                  value={
                    value('reviewFrequencyMonths') === null
                      ? ''
                      : String(value('reviewFrequencyMonths'))
                  }
                  onChange={(e) => setField('reviewFrequencyMonths', e.target.value)}
                  disabled={!editable}
                  placeholder={String(suggestedFraReviewMonths(rating))}
                />
                <p className="text-xs text-muted-foreground">
                  {t('reviewMonthsSuggestion', { count: suggestedFraReviewMonths(rating) })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {editable && draft !== null ? (
          <div className="sticky bottom-4 flex justify-end">
            <Button onClick={save} disabled={updateFra.isPending}>
              {t('saveButton')}
            </Button>
          </div>
        ) : null}

        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                {t('findingsHeading', { open: openFindings.length, total: fra.findings.length })}
              </h2>
            </div>
            {fra.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noFindings')}</p>
            ) : (
              <ul className="space-y-2">
                {fra.findings.map((finding) => (
                  <li
                    key={finding.id}
                    className="flex flex-wrap items-start gap-2 rounded-md border px-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{t(`findingCategories.${finding.category}` as never)}</span>
                        <span
                          className={
                            finding.priority === 'high'
                              ? 'font-medium text-red-600 dark:text-red-400'
                              : finding.priority === 'medium'
                                ? 'font-medium text-amber-600 dark:text-amber-400'
                                : ''
                          }
                        >
                          {t(`findingPriorities.${finding.priority}` as never)}
                        </span>
                        {finding.resolvedAt !== null ? <span>{t('findingResolved')}</span> : null}
                        {finding.actionId !== null ? (
                          <span>{t('findingHasActionChip')}</span>
                        ) : null}
                      </div>
                      <p className={finding.resolvedAt !== null ? 'line-through opacity-60' : ''}>
                        {finding.description}
                      </p>
                    </div>
                    {editable && finding.resolvedAt === null ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resolveFinding.mutate({ findingId: finding.id })}
                      >
                        {t('resolveButton')}
                      </Button>
                    ) : null}
                    {editable && finding.actionId === null ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeFinding.mutate({ findingId: finding.id })}
                      >
                        {t('removeButton')}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {editable ? (
              <div className="space-y-3 rounded-md border p-4">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {t('addFindingHeading')}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="finding-category">{t('findingCategory')}</Label>
                    <select
                      id="finding-category"
                      value={findingCategory}
                      onChange={(e) => setFindingCategory(e.target.value)}
                      className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {FRA_FINDING_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {t(`findingCategories.${c}` as never)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="finding-priority">{t('findingPriority')}</Label>
                    <select
                      id="finding-priority"
                      value={findingPriority}
                      onChange={(e) => setFindingPriority(e.target.value)}
                      className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {FRA_FINDING_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {t(`findingPriorities.${p}` as never)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="finding-description">{t('findingDescription')}</Label>
                  <Textarea
                    id="finding-description"
                    rows={2}
                    value={findingDescription}
                    onChange={(e) => setFindingDescription(e.target.value)}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={findingRequiresAction}
                    onChange={(e) => setFindingRequiresAction(e.target.checked)}
                    className="h-4 w-4"
                  />
                  {t('findingRequiresAction')}
                </label>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={findingDescription.trim() === '' || addFinding.isPending}
                    onClick={() =>
                      addFinding.mutate({
                        fraId,
                        category: findingCategory as never,
                        priority: findingPriority as never,
                        description: findingDescription.trim(),
                        requiresAction: findingRequiresAction,
                      })
                    }
                  >
                    {t('addFindingButton')}
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">{t('reviewsHeading')}</h2>
            {fra.status === 'active' && canEdit ? (
              <div className="space-y-3 rounded-md border p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="review-trigger">{t('reviewTrigger')}</Label>
                    <select
                      id="review-trigger"
                      value={reviewTrigger}
                      onChange={(e) => setReviewTrigger(e.target.value)}
                      className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {(
                        [
                          'scheduled',
                          'post_incident',
                          'material_change',
                          'legislation_change',
                          'manual',
                        ] as const
                      ).map((trigger) => (
                        <option key={trigger} value={trigger}>
                          {t(`reviewTriggers.${trigger}` as never)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="review-outcome">{t('reviewOutcome')}</Label>
                    <select
                      id="review-outcome"
                      value={reviewOutcome}
                      onChange={(e) => setReviewOutcome(e.target.value)}
                      className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="confirmed">{t('reviewOutcomes.confirmed')}</option>
                      <option value="updated">{t('reviewOutcomes.updated')}</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="review-note">{t('reviewNote')}</Label>
                  <Textarea
                    id="review-note"
                    rows={2}
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={recordReview.isPending}
                    onClick={() =>
                      recordReview.mutate({
                        fraId,
                        trigger: reviewTrigger as never,
                        outcome: reviewOutcome as never,
                        note: reviewNote,
                      })
                    }
                  >
                    {t('recordReviewButton')}
                  </Button>
                </div>
              </div>
            ) : null}
            {fra.reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noReviews')}</p>
            ) : (
              <ul className="space-y-1.5">
                {fra.reviews.map((review) => (
                  <li key={review.id} className="rounded-md border px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {t(`reviewTriggers.${review.trigger}` as never)}
                      </span>
                      <span>{t(`reviewOutcomes.${review.outcome}` as never)}</span>
                      <span className="ml-auto">{formatDate(review.reviewedAt, locale)}</span>
                    </div>
                    {review.note !== '' ? <p className="mt-1">{review.note}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* FS-9: the sign-off dialog — the words being attested, what is
          still missing, and the actions the publish will raise. */}
      <Dialog
        open={signOffOpen}
        onOpenChange={(open) => {
          setSignOffOpen(open);
          if (!open) setSignOffChecked(false);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('signOff.title')}</DialogTitle>
          </DialogHeader>
          {(() => {
            const missing: string[] = [];
            if (fra.riskRating === null) missing.push(t('publishErrors.noRiskRating'));
            if (fra.responsiblePersonName.trim().length === 0)
              missing.push(t('publishErrors.noResponsiblePerson'));
            if (fra.personsAtRisk.length === 0) missing.push(t('publishErrors.noPersonsAtRisk'));
            if (fra.ignitionSources.trim().length === 0)
              missing.push(t('publishErrors.noIgnitionSources'));
            if (fra.fuelSources.trim().length === 0) missing.push(t('publishErrors.noFuelSources'));
            if (fra.oxygenSources.trim().length === 0)
              missing.push(t('publishErrors.noOxygenSources'));
            if (fra.evaluationNotes.trim().length === 0)
              missing.push(t('publishErrors.noEvaluation'));
            const pendingActions = fra.findings.filter(
              (f) => f.requiresAction && f.actionId === null && f.resolvedAt === null,
            ).length;
            const intolerableBlocked =
              fra.riskRating === 'intolerable' &&
              !fra.findings.some(
                (f) => f.resolvedAt === null && (f.requiresAction || f.actionId !== null),
              );
            return (
              <div className="space-y-3 text-sm">
                {fra.riskRating === 'intolerable' ? (
                  <p className="rounded-md border border-red-300 bg-red-50 p-2 font-medium text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                    {t('signOff.intolerableWarning')}
                  </p>
                ) : null}
                {missing.length > 0 ? (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    <p className="font-medium">{t('signOff.missingHeading')}</p>
                    <ul className="mt-1 list-inside list-disc">
                      {missing.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {intolerableBlocked ? (
                  <p className="text-red-700 dark:text-red-300">
                    {t('publishErrors.intolerableNeedsAction')}
                  </p>
                ) : null}
                <p>
                  {fra.findings.length === 0
                    ? t('signOff.noFindingsNote')
                    : t('signOff.actionsPreview', {
                        findings: fra.findings.length,
                        actions: pendingActions,
                      })}
                </p>
                <label className="flex items-start gap-2 rounded-md border p-3">
                  <Checkbox
                    checked={signOffChecked}
                    onCheckedChange={(v) => setSignOffChecked(v === true)}
                  />
                  <span>{t('signOff.statement')}</span>
                </label>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setSignOffOpen(false)}>
                    {tShared('cancel')}
                  </Button>
                  <Button
                    disabled={
                      !signOffChecked ||
                      missing.length > 0 ||
                      intolerableBlocked ||
                      publishFra.isPending
                    }
                    onClick={() =>
                      publishFra.mutate({
                        fraId,
                        ...(fra.findings.length === 0
                          ? { confirmNoSignificantFindings: true }
                          : {}),
                      })
                    }
                  >
                    {fra.status === 'active'
                      ? t('signOff.reattestButton')
                      : t('signOff.confirmButton')}
                  </Button>
                </DialogFooter>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={raiseOpen} onOpenChange={setRaiseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('raiseAction.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="raise-title">{t('raiseAction.titleLabel')}</Label>
              <Input
                id="raise-title"
                value={raiseTitle}
                onChange={(e) => setRaiseTitle(e.target.value)}
                maxLength={300}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="raise-desc">{t('raiseAction.descriptionLabel')}</Label>
              <Textarea
                id="raise-desc"
                value={raiseDescription}
                onChange={(e) => setRaiseDescription(e.target.value)}
                rows={3}
                maxLength={4000}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="raise-priority">{t('raiseAction.priorityLabel')}</Label>
                <select
                  id="raise-priority"
                  value={raisePriority}
                  onChange={(e) =>
                    setRaisePriority(e.target.value as 'low' | 'medium' | 'high' | 'critical')
                  }
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {(['low', 'medium', 'high', 'critical'] as const).map((p) => (
                    <option key={p} value={p}>
                      {t(`raiseAction.priorities.${p}` as never)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="raise-due">{t('raiseAction.dueLabel')}</Label>
                <Input
                  id="raise-due"
                  type="date"
                  value={raiseDue}
                  onChange={(e) => setRaiseDue(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('raiseAction.assigneeLabel')}</Label>
              <UserPicker
                value={raiseAssignee}
                onChange={setRaiseAssignee}
                placeholder={t('raiseAction.assigneeSelf')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRaiseOpen(false)}>
              {t('raiseAction.cancel')}
            </Button>
            <Button
              disabled={raiseAction.isPending || raiseTitle.trim() === ''}
              onClick={() =>
                raiseAction.mutate({
                  fraId,
                  title: raiseTitle.trim(),
                  description: raiseDescription.trim(),
                  priority: raisePriority,
                  ...(raiseAssignee?.userId != null
                    ? { assigneeUserId: raiseAssignee.userId }
                    : {}),
                  ...(raiseDue !== ''
                    ? { dueAt: new Date(`${raiseDue}T12:00:00Z`).toISOString() }
                    : {}),
                })
              }
            >
              {raiseAction.isPending ? t('raiseAction.saving') : t('raiseAction.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
