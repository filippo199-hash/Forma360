'use client';

/**
 * Risk assessment detail — the HSE five-step editor.
 *
 * Publish flow (per the practitioner review): the Publish button first
 * guards the title (suggesting one if the assessment is still untitled),
 * then — when planned controls exist — shows a confirmation dialog
 * previewing the actions that will be created (assignee = publisher,
 * medium priority, due in 7 days) with the assessor sign-off statement.
 * No planned controls → publishes directly. A second Publish button sits
 * at the bottom of the page so nobody scrolls back up.
 *
 * Printing: the on-screen editor is `print:hidden`; a compact print-only
 * block renders the whole record to fit one page (globals.css strips the
 * app shell in @media print).
 */
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { HazardCard } from '../../../../src/components/risk-assessments/hazard-card';
import { HazardQuickAdd } from '../../../../src/components/risk-assessments/hazard-quick-add';
import { DistributionSection } from '../../../../src/components/risk-assessments/distribution-section';
import { RaStatusChip } from '../../../../src/components/risk-assessments/status-chip';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { ReviewSection } from '../../../../src/components/risk-assessments/review-section';
import { Button } from '../../../../src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../src/components/ui/dialog';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '../../../../src/components/ui/tabs';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { bandForScore, scoreFor } from '../../../../src/lib/risk-matrix';
import { trpc } from '../../../../src/lib/trpc/client';

const PUBLISH_ERRORS = new Set(['no-hazards', 'unscored-hazards', 'ppe-only-needs-justification']);

const PRESET_GROUPS = [
  'employees',
  'cleaners',
  'contractors',
  'visitors',
  'young_persons',
  'new_expectant_mothers',
  'lone_workers',
  'members_of_public',
] as const;

export default function RiskAssessmentDetailPage() {
  const t = useTranslations('riskAssessments');
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ assessmentId: string }>();
  const assessmentId = params.assessmentId;
  const canManage = useHasPermission('riskAssessments.manage');
  const canCreate = useHasPermission('riskAssessments.create');

  const utils = trpc.useUtils();
  const query = trpc.riskAssessments.get.useQuery({ assessmentId });
  const [panelTab, setPanelTab] = useState<'review' | 'distribution'>('review');
  const [titleText, setTitleText] = useState<string | null>(null);
  const [titleDialogOpen, setTitleDialogOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showBottomAdd, setShowBottomAdd] = useState(false);
  const [sharing, setSharing] = useState(false);

  const refresh = (): void => {
    void utils.riskAssessments.get.invalidate({ assessmentId });
    void utils.riskAssessments.list.invalidate();
  };

  const update = trpc.riskAssessments.update.useMutation({
    onSuccess: refresh,
    onError: () => toast.error(t('saveError')),
  });
  const publish = trpc.riskAssessments.publish.useMutation({
    onSuccess: (res) => {
      setConfirmOpen(false);
      toast.success(t('publish.successToast'));
      if (res.actionsCreated > 0) {
        toast.success(t('publish.actionsCreated', { count: res.actionsCreated }));
      }
      refresh();
    },
    onError: (err) => {
      setConfirmOpen(false);
      const key = PUBLISH_ERRORS.has(err.message) ? err.message : 'generic';
      toast.error(t(`publish.errors.${key}` as never));
    },
  });
  const archive = trpc.riskAssessments.archive.useMutation({
    onSuccess: refresh,
    onError: () => toast.error(t('saveError')),
  });
  const moveToDraft = trpc.riskAssessments.moveToDraft.useMutation({
    onSuccess: refresh,
    onError: () => toast.error(t('saveError')),
  });
  const acknowledge = trpc.riskAssessments.acknowledge.useMutation({
    onSuccess: () => {
      toast.success(t('distribution.acknowledgedToast'));
      refresh();
      void utils.riskAssessments.listMyPending.invalidate();
    },
    onError: () => toast.error(t('saveError')),
  });
  const createVariant = trpc.riskAssessments.createPersonSpecific.useMutation({
    onSuccess: (res) => {
      toast.success(t('personSpecific.createdToast'));
      router.push(`/${locale}/risk-assessments/${res.assessmentId}`);
    },
    onError: () => toast.error(t('saveError')),
  });
  // Renders the PDF into R2 for the Heads Up hand-off; errors are handled
  // inline in shareViaHeadsUp (the share still goes out without the file).
  const prepareAttachment = trpc.riskAssessments.prepareHeadsUpAttachment.useMutation();

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 px-4 py-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.data === undefined) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 text-center text-sm text-muted-foreground">
        {t('notFound')}
      </div>
    );
  }

  const {
    assessment,
    siteName,
    parentUpdatedAt,
    events,
    createdByName,
    hazards,
    reviews,
    acknowledgements,
    linkedVariants,
    linkedActions,
    myAcknowledgement,
  } = query.data;
  const editable = canManage && assessment.archivedAt === null;
  const title = titleText ?? assessment.title;
  const affected = new Set(hazards.flatMap((h) => [...h.affectedGroups]));
  const variantKinds = new Set(linkedVariants.map((v) => v.personSpecificFor));
  const suggestYoung =
    assessment.personSpecificFor === null &&
    affected.has('young_persons') &&
    !variantKinds.has('young_person');
  const suggestExpectant =
    assessment.personSpecificFor === null &&
    affected.has('new_expectant_mothers') &&
    !variantKinds.has('new_expectant_mother');
  const pendingPlanned = hazards
    .flatMap((h) => h.controls)
    .filter((c) => c.status === 'planned' && c.actionId === null);
  const isUntitled = title.trim().length === 0 || title === t('untitled');

  function suggestTitle(): string {
    const firstHazard = hazards[0];
    if (firstHazard !== undefined && firstHazard.hazard.trim().length > 0) {
      return `${firstHazard.hazard} — ${new Date().getFullYear()}`;
    }
    if (assessment.activity.trim().length > 0) {
      return assessment.activity.trim().slice(0, 80);
    }
    return `${assessment.referenceNumber ?? ''} ${new Date().toLocaleDateString(locale)}`.trim();
  }

  function proceedAfterTitle(): void {
    if (pendingPlanned.length > 0) {
      setConfirmOpen(true);
    } else {
      publish.mutate({ assessmentId });
    }
  }

  function startPublish(): void {
    if (isUntitled) {
      setTitleDraft(suggestTitle());
      setTitleDialogOpen(true);
    } else {
      proceedAfterTitle();
    }
  }

  function saveTitle(next: string): void {
    setTitleText(next);
    update.mutate({ assessmentId, title: next });
  }

  /**
   * Point 5 of the practitioner review: distribution rides the Heads Up
   * machinery. Publish first (validations apply), render the PDF copy of
   * the record, then land on the Heads Up composer pre-filled with the
   * PDF attached — the user only picks the recipients.
   */
  async function shareViaHeadsUp(): Promise<void> {
    if (sharing) return;
    setSharing(true);
    try {
      if (assessment.status !== 'active') {
        await publish.mutateAsync({ assessmentId });
      }
      const huTitle = `${title} (${assessment.referenceNumber ?? ''})`.trim();
      const link = `${window.location.origin}/${locale}/risk-assessments/${assessmentId}`;
      const huDescription = `${t('distribution.acknowledgeBanner')}\n\n${huTitle}\n${link}`;
      // The PDF is best-effort: if rendering fails the share still goes
      // out, just without the file.
      let attQuery = '';
      try {
        const att = await prepareAttachment.mutateAsync({ assessmentId });
        attQuery =
          `&attKey=${encodeURIComponent(att.storageKey)}` +
          `&attName=${encodeURIComponent(att.filename)}` +
          `&attSize=${att.sizeBytes}`;
      } catch {
        toast.error(t('distribution.attachmentFailed'));
      }
      router.push(
        `/${locale}/heads-up/new?title=${encodeURIComponent(huTitle)}&description=${encodeURIComponent(huDescription)}${attQuery}`,
      );
    } catch {
      // publish.mutateAsync already surfaced the specific toast.
    } finally {
      setSharing(false);
    }
  }

  const publishButton = (
    <Button type="button" disabled={publish.isPending} onClick={startPublish}>
      {publish.isPending
        ? t('publish.publishing')
        : assessment.status === 'active'
          ? t('publish.republish')
          : t('publish.button')}
    </Button>
  );

  const createdLine =
    createdByName !== null
      ? t('createdByLine', {
          name: createdByName,
          date: new Date(assessment.createdAt).toLocaleDateString(locale),
        })
      : null;

  return (
    <>
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 print:hidden">
        <Link
          href={`/${locale}/risk-assessments`}
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          ← {t('backToList')}
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {editable ? (
                <Input
                  className="h-9 max-w-xl border-transparent px-1 text-xl font-semibold shadow-none hover:border-input focus-visible:border-input"
                  value={title}
                  placeholder={t('create.titlePlaceholder')}
                  onChange={(e) => setTitleText(e.target.value)}
                  onBlur={() => {
                    const next = title.trim();
                    if (next.length > 0 && next !== assessment.title) {
                      saveTitle(next);
                    }
                  }}
                />
              ) : (
                <h1 className="text-xl font-semibold">{title}</h1>
              )}
              <span className="font-mono text-xs text-muted-foreground">
                {assessment.referenceNumber}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {t(`type.${assessment.type}`)}
              </span>
              <RaStatusChip status={assessment.status} />
              {assessment.personSpecificFor !== null ? (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {t(`personSpecific.badge.${assessment.personSpecificFor}`)}
                </span>
              ) : null}
              {!editable && siteName !== null ? (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{siteName}</span>
              ) : null}
              {createdLine !== null ? (
                <span className="text-xs text-muted-foreground">{createdLine}</span>
              ) : null}
            </div>
            {editable ? (
              <div className="mt-2 max-w-sm">
                <SiteSelector
                  multiple={false}
                  value={assessment.siteId !== null ? [assessment.siteId] : []}
                  onChange={(next) => update.mutate({ assessmentId, siteId: next[0] ?? null })}
                  placeholder={t('site.none')}
                />
              </div>
            ) : null}
            {assessment.activity.length > 0 ? (
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{assessment.activity}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={() => window.print()}>
              {t('print')}
            </Button>
            {editable ? (
              <>
                {publishButton}
                {assessment.status === 'active' ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={moveToDraft.isPending}
                    onClick={() => moveToDraft.mutate({ assessmentId })}
                  >
                    {t('moveToDraft')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (window.confirm(t('publish.archiveConfirm'))) {
                      archive.mutate({ assessmentId });
                    }
                  }}
                >
                  {t('publish.archiveButton')}
                </Button>
              </>
            ) : null}
            {canManage && assessment.status === 'archived' ? (
              <Button
                type="button"
                variant="outline"
                disabled={moveToDraft.isPending}
                onClick={() => moveToDraft.mutate({ assessmentId })}
              >
                {t('moveToDraft')}
              </Button>
            ) : null}
          </div>
        </div>

        {myAcknowledgement !== null && myAcknowledgement.acknowledgedAt === null ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <span>{t('distribution.acknowledgeBanner')}</span>
            <Button
              type="button"
              size="sm"
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate({ assessmentId })}
            >
              {acknowledge.isPending
                ? t('distribution.acknowledging')
                : t('distribution.acknowledgeButton')}
            </Button>
          </div>
        ) : null}

        {(suggestYoung || suggestExpectant) && canCreate ? (
          <div className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
            <p className="font-medium">{t('personSpecific.promptTitle')}</p>
            <p className="mt-0.5 text-xs">
              {t('personSpecific.promptBody', {
                group: [
                  ...(suggestYoung ? [t('hazards.groups.young_persons')] : []),
                  ...(suggestExpectant ? [t('hazards.groups.new_expectant_mothers')] : []),
                ].join(' · '),
              })}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestYoung ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={createVariant.isPending}
                  onClick={() => createVariant.mutate({ assessmentId, kind: 'young_person' })}
                >
                  {t('personSpecific.createYoung')}
                </Button>
              ) : null}
              {suggestExpectant ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={createVariant.isPending}
                  onClick={() =>
                    createVariant.mutate({ assessmentId, kind: 'new_expectant_mother' })
                  }
                >
                  {t('personSpecific.createExpectant')}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {linkedVariants.length > 0 ? (
          <div className="text-sm">
            <span className="font-medium">{t('personSpecific.linkedTitle')}: </span>
            {linkedVariants.map((v) => (
              <Link
                key={v.id}
                className="mr-2 underline underline-offset-2"
                href={`/${locale}/risk-assessments/${v.id}`}
              >
                {v.personSpecificFor !== null
                  ? t(`personSpecific.badge.${v.personSpecificFor}`)
                  : v.title}
              </Link>
            ))}
          </div>
        ) : null}
        {assessment.parentAssessmentId !== null ? (
          <Link
            className="block text-sm text-muted-foreground underline underline-offset-2"
            href={`/${locale}/risk-assessments/${assessment.parentAssessmentId}`}
          >
            {t('personSpecific.parentLink', { title })}
          </Link>
        ) : null}
        {assessment.parentAssessmentId !== null &&
        parentUpdatedAt !== null &&
        new Date(parentUpdatedAt) > new Date(assessment.updatedAt) ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            {t('personSpecific.driftBanner')}
          </div>
        ) : null}

        <div>
          <h2 className="text-base font-semibold">{t('hazards.sectionTitle')}</h2>
          <p className="max-w-3xl text-xs text-muted-foreground">{t('hazards.sectionHint')}</p>
        </div>

        {editable ? <HazardQuickAdd assessmentId={assessmentId} onAdded={refresh} /> : null}

        {hazards.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t('hazards.emptyHint')}
          </div>
        ) : (
          <div className="space-y-3">
            {hazards.map((h) => (
              <HazardCard
                key={h.id}
                hazard={h}
                matrix={assessment.matrix}
                canManage={editable}
                canRemove={hazards.length > 1}
                presetGroups={PRESET_GROUPS}
                onChanged={refresh}
              />
            ))}
          </div>
        )}

        {editable && hazards.length > 0 ? (
          showBottomAdd ? (
            <HazardQuickAdd assessmentId={assessmentId} onAdded={refresh} />
          ) : (
            <button
              type="button"
              onClick={() => setShowBottomAdd(true)}
              className="w-full rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              + {t('hazards.addAnother')}
            </button>
          )
        ) : null}

        {linkedActions.length > 0 ? (
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">{t('linkedActions.title')}</p>
            <ul className="space-y-1.5">
              {linkedActions.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/${locale}/actions/${a.id}`}
                    className="flex flex-wrap items-center gap-2 text-sm hover:underline"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {a.referenceNumber}
                    </span>
                    <span className="min-w-0 flex-1">{a.title}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{a.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Review + Distribution share one tabbed card to save vertical space. */}
        <Card>
          <CardContent className="space-y-4 pt-4">
            <Tabs
              value={panelTab}
              onValueChange={(v) => setPanelTab(v === 'distribution' ? 'distribution' : 'review')}
            >
              <TabsList>
                <TabsTrigger value="review">{t('review.sectionTitle')}</TabsTrigger>
                <TabsTrigger value="distribution">{t('distribution.sectionTitle')}</TabsTrigger>
              </TabsList>
            </Tabs>
            {panelTab === 'review' ? (
              <ReviewSection
                assessmentId={assessmentId}
                reviewFrequencyMonths={assessment.reviewFrequencyMonths}
                nextReviewAt={assessment.nextReviewAt}
                lastReviewedAt={assessment.lastReviewedAt}
                reviews={reviews}
                canManage={editable}
                onChanged={refresh}
              />
            ) : (
              <DistributionSection
                assessmentId={assessmentId}
                isActive={assessment.status === 'active'}
                acknowledgements={acknowledgements}
                canManage={canManage && assessment.archivedAt === null}
                onChanged={refresh}
                onShareHeadsUp={() => void shareViaHeadsUp()}
                sharing={sharing}
              />
            )}
          </CardContent>
        </Card>

        {events.length > 0 ? (
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">{t('changeLog.title')}</p>
            <ul className="space-y-1">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString(locale)}
                  </span>
                  <span className="font-medium">{e.actorName ?? '—'}</span>
                  <span>{t(`changeLog.kinds.${e.kind}` as never)}</span>
                  {e.detail.length > 0 ? (
                    <span className="text-muted-foreground">— {e.detail}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {editable ? <div className="flex justify-end pb-4">{publishButton}</div> : null}
      </div>

      {/* One-page print record. */}
      <div className="hidden print:block px-6 py-4 text-[11px] leading-tight text-black">
        <div className="mb-1 flex items-baseline justify-between border-b border-black pb-1">
          <span className="text-base font-bold">{title}</span>
          <span className="font-mono">{assessment.referenceNumber}</span>
        </div>
        <p className="mb-2">
          {t(`type.${assessment.type}`)} · {t(`status.${assessment.status}`)}
          {siteName !== null ? ` · ${siteName}` : ''}
          {createdLine !== null ? ` · ${createdLine}` : ''}
          {assessment.nextReviewAt !== null
            ? ` · ${t('review.nextReviewLabel')}: ${new Date(assessment.nextReviewAt).toLocaleDateString(locale)}`
            : ''}
        </p>
        {assessment.activity.length > 0 ? <p className="mb-2">{assessment.activity}</p> : null}
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {[
                t('hazards.hazardLabel'),
                t('hazards.affectedLabel'),
                t('hazards.initialRisk'),
                t('controls.sectionTitle'),
                t('hazards.residualRisk'),
              ].map((h) => (
                <th key={h} className="border border-black px-1 py-0.5 text-left align-top">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hazards.map((h) => {
              const initial = scoreFor(h.initialLikelihood, h.initialSeverity);
              const residual = scoreFor(h.residualLikelihood, h.residualSeverity);
              return (
                <tr key={h.id}>
                  <td className="border border-black px-1 py-0.5 align-top">
                    <span className="font-semibold">{h.hazard}</span>
                    {h.harmDescription.length > 0 ? <> — {h.harmDescription}</> : null}
                  </td>
                  <td className="border border-black px-1 py-0.5 align-top">
                    {h.affectedGroups
                      .map((g) =>
                        (PRESET_GROUPS as ReadonlyArray<string>).includes(g)
                          ? t(`hazards.groups.${g}` as never)
                          : g,
                      )
                      .join(', ')}
                  </td>
                  <td className="border border-black px-1 py-0.5 align-top">
                    {initial !== null
                      ? `${initial} (${t(`band.${bandForScore(initial, assessment.matrix)}`)})`
                      : '—'}
                  </td>
                  <td className="border border-black px-1 py-0.5 align-top">
                    {h.existingControls.length > 0 ? <p>{h.existingControls}</p> : null}
                    {h.controls.map((c) => (
                      <p key={c.id}>
                        [{t(`controls.tier.${c.tier}`)}] {c.description}
                        {c.status === 'planned' ? ` (${t('controls.statusPlanned')})` : ''}
                      </p>
                    ))}
                  </td>
                  <td className="border border-black px-1 py-0.5 align-top">
                    {residual !== null
                      ? `${residual} (${t(`band.${bandForScore(residual, assessment.matrix)}`)})`
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2">
          {t('publishConfirm.signOff')}
          {createdByName !== null ? ` — ${createdByName}` : ''}
          {assessment.publishedAt !== null
            ? `, ${new Date(assessment.publishedAt).toLocaleDateString(locale)}`
            : ''}
        </p>
      </div>

      {/* Title guard before publishing an untitled assessment. */}
      <Dialog open={titleDialogOpen} onOpenChange={setTitleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('titlePrompt.title')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('titlePrompt.hint')}</p>
          <Input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && titleDraft.trim().length > 0) {
                e.preventDefault();
                saveTitle(titleDraft.trim());
                setTitleDialogOpen(false);
                proceedAfterTitle();
              }
            }}
          />
          <DialogFooter>
            <Button
              type="button"
              disabled={titleDraft.trim().length === 0}
              onClick={() => {
                saveTitle(titleDraft.trim());
                setTitleDialogOpen(false);
                proceedAfterTitle();
              }}
            >
              {t('titlePrompt.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish confirmation with the actions that will be created. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('publishConfirm.title')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {t('publishConfirm.actionsIntro', { count: pendingPlanned.length })}
          </p>
          <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
            {pendingPlanned.map((c) => (
              <li key={c.id} className="rounded border px-2 py-1.5">
                <span className="block">{c.description}</span>
                <span className="block text-xs text-muted-foreground">
                  {t('publishConfirm.actionMeta')}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t('publishConfirm.signOff')}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              {t('publishConfirm.cancel')}
            </Button>
            <Button
              type="button"
              disabled={publish.isPending}
              onClick={() => publish.mutate({ assessmentId })}
            >
              {publish.isPending ? t('publish.publishing') : t('publishConfirm.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
