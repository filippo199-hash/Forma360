'use client';

/**
 * Risk assessment detail — the HSE five-step editor.
 *
 * Publish flow (feedback round 2): Publish ALWAYS opens the sign-off
 * dialog (M-2) — the assessor actively ticks the "suitable and
 * sufficient" confirmation on every publish, and every planned control
 * gets an explicit owner + due date right there in the dialog (P-3).
 * Each publish freezes an immutable version; editing a live assessment
 * shows an "unpublished changes" banner until the changes are
 * republished, which re-opens everyone's acknowledgement (A-1/M-3).
 *
 * Sharing (T-4/A-2): "Share via Heads Up" never publishes — it is only
 * available on active assessments and passes ?raId= so the composer
 * mirrors the heads-up recipients into the acknowledgement tracker.
 *
 * Printing (M-4): the print block paginates per hazard at a readable
 * size, and "Download PDF" serves the proper multi-page rendered PDF.
 */
import { Archive, Download, Printer } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { HazardCard } from '../../../../src/components/risk-assessments/hazard-card';
import { HazardQuickAdd } from '../../../../src/components/risk-assessments/hazard-quick-add';
import { DistributionSection } from '../../../../src/components/risk-assessments/distribution-section';
import { RaStatusChip } from '../../../../src/components/risk-assessments/status-chip';
import { TooltipIconButton } from '../../../../src/components/ui/tooltip-icon-button';
import { VersionViewer } from '../../../../src/components/risk-assessments/version-viewer';
import { GroupUserSelector } from '../../../../src/components/selectors/group-user-selector';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { ReviewSection } from '../../../../src/components/risk-assessments/review-section';
import { Button } from '../../../../src/components/ui/button';
import { Checkbox } from '../../../../src/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../src/components/ui/dialog';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '../../../../src/components/ui/tabs';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { bandFor, scoreFor } from '../../../../src/lib/risk-matrix';
import { trpc } from '../../../../src/lib/trpc/client';

const PUBLISH_ERRORS = new Set([
  'no-hazards',
  'unscored-hazards',
  'ppe-only-needs-justification',
  'residual-above-initial',
  'residual-needs-controls',
  'high-residual-needs-justification',
  'actions-need-assignees',
  'invalid-assignee',
  'invalid-due-date',
]);

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

function defaultDueDateInput(): string {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

interface AssignmentDraft {
  assigneeIds: string[];
  due: string;
}

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
  const [panelTab, setPanelTab] = useState<'review' | 'distribution' | 'versions'>('review');
  const [titleText, setTitleText] = useState<string | null>(null);
  const [activityText, setActivityText] = useState<string | null>(null);
  const [titleDialogOpen, setTitleDialogOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signOffChecked, setSignOffChecked] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, AssignmentDraft>>({});
  const [showBottomAdd, setShowBottomAdd] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [viewVersion, setViewVersion] = useState<number | null>(null);

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
      if (res.reacknowledgementRequested) {
        toast.success(t('publish.reackToast', { version: res.version }));
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
    events,
    createdByName,
    hazards,
    reviews,
    acknowledgements,
    versions,
    hasUnpublishedChanges,
    linkedVariants,
    parentInfo,
    linkedActions,
    myAcknowledgement,
  } = query.data;
  const editable = canManage && assessment.archivedAt === null;
  const title = titleText ?? assessment.title;
  const activity = activityText ?? assessment.activity;
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
  const currentVersionRow = versions.find((v) => v.versionNumber === assessment.currentVersion);
  const nextVersionNumber = assessment.currentVersion + (hasUnpublishedChanges ? 1 : 0);
  const myAckPending =
    myAcknowledgement !== null &&
    (myAcknowledgement.acknowledgedAt === null ||
      (myAcknowledgement.acknowledgedVersion ?? 0) < myAcknowledgement.versionNumber);
  const myAckIsReack = myAckPending && myAcknowledgement.acknowledgedAt !== null;

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

  /** Publish ALWAYS goes through the sign-off dialog (M-2). */
  function openPublishDialog(): void {
    setAssignments((prev) => {
      const next: Record<string, AssignmentDraft> = {};
      for (const c of pendingPlanned) {
        next[c.id] = prev[c.id] ?? { assigneeIds: [], due: defaultDueDateInput() };
      }
      return next;
    });
    setSignOffChecked(false);
    setConfirmOpen(true);
  }

  function startPublish(): void {
    if (isUntitled) {
      setTitleDraft(suggestTitle());
      setTitleDialogOpen(true);
    } else {
      openPublishDialog();
    }
  }

  function saveTitle(next: string): void {
    setTitleText(next);
    update.mutate({ assessmentId, title: next });
  }

  const assignmentsComplete = pendingPlanned.every((c) => {
    const a = assignments[c.id];
    return a !== undefined && a.assigneeIds.length === 1 && a.due.length === 10;
  });

  function submitPublish(): void {
    if (!signOffChecked || !assignmentsComplete || publish.isPending) return;
    publish.mutate({
      assessmentId,
      confirmSignOff: true,
      actionAssignments: pendingPlanned.map((c) => {
        const a = assignments[c.id];
        return {
          controlId: c.id,
          assigneeUserId: a?.assigneeIds[0] ?? '',
          dueAt: new Date(`${a?.due ?? defaultDueDateInput()}T12:00:00.000Z`),
        };
      }),
    });
  }

  /**
   * T-4/A-2: sharing never publishes. Only reachable when active; renders
   * the PDF of the published record and lands on the Heads Up composer
   * with ?raId= so the composer mirrors recipients into the
   * acknowledgement tracker after it sends.
   */
  async function shareViaHeadsUp(): Promise<void> {
    if (sharing || assessment.status !== 'active') return;
    setSharing(true);
    try {
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
        `/${locale}/heads-up/new?raId=${assessmentId}&title=${encodeURIComponent(huTitle)}&description=${encodeURIComponent(huDescription)}${attQuery}`,
      );
    } finally {
      setSharing(false);
    }
  }

  const showPublishButton = editable && (assessment.status !== 'active' || hasUnpublishedChanges);
  const publishButton = showPublishButton ? (
    <Button type="button" disabled={publish.isPending} onClick={startPublish}>
      {publish.isPending
        ? t('publish.publishing')
        : assessment.status === 'active'
          ? t('publish.publishChanges', { version: assessment.currentVersion + 1 })
          : t('publish.button')}
    </Button>
  ) : null;

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
                  className="h-9 max-w-xl border-transparent bg-transparent px-1 text-xl font-semibold shadow-none hover:border-input focus-visible:border-input"
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
              {assessment.currentVersion > 0 ? (
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {`v${assessment.currentVersion}`}
                </span>
              ) : null}
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
            {/* T-2: the activity / scope line — the most important sentence
                on a dynamic assessment — is a first-class editable field. */}
            {editable ? (
              <div className="mt-2 max-w-3xl space-y-1">
                <Label className="text-xs">{t('create.activityLabel')}</Label>
                <Textarea
                  rows={2}
                  value={activity}
                  placeholder={t('create.activityPlaceholder')}
                  onChange={(e) => setActivityText(e.target.value)}
                  onBlur={() => {
                    if (activity !== assessment.activity) {
                      update.mutate({ assessmentId, activity });
                    }
                  }}
                />
              </div>
            ) : assessment.activity.length > 0 ? (
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{assessment.activity}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <TooltipIconButton icon={Printer} label={t('print')} onClick={() => window.print()} />
            {/* M-4: proper multi-page PDF straight from the screen. */}
            <TooltipIconButton
              icon={Download}
              label={t('downloadPdf')}
              href={`/api/exports/risk-assessment-pdf?assessmentId=${assessmentId}`}
              target="_blank"
            />
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
                <TooltipIconButton
                  icon={Archive}
                  label={t('publish.archiveButton')}
                  onClick={() => {
                    if (window.confirm(t('publish.archiveConfirm'))) {
                      archive.mutate({ assessmentId });
                    }
                  }}
                />
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

        {/* A-1: live document has edits nobody has re-acknowledged yet. */}
        {hasUnpublishedChanges && canManage ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-900 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-200">
            <span>
              {t('versions.unpublishedChangesBanner', { version: assessment.currentVersion })}
            </span>
            {showPublishButton ? (
              <Button type="button" size="sm" onClick={startPublish}>
                {t('publish.publishChanges', { version: assessment.currentVersion + 1 })}
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* A-4: this variant's parent moved on since the fork. */}
        {parentInfo !== null && parentInfo.changedSinceFork ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            {t('personSpecific.driftBanner')}{' '}
            <Link
              className="font-medium underline underline-offset-2"
              href={`/${locale}/risk-assessments/${parentInfo.id}`}
            >
              {parentInfo.title} {parentInfo.referenceNumber ?? ''}
            </Link>
          </div>
        ) : null}

        {myAckPending ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <span>
              {myAckIsReack
                ? t('distribution.reacknowledgeBanner', {
                    version: myAcknowledgement.versionNumber,
                  })
                : t('distribution.acknowledgeBanner')}
              {myAcknowledgement.dueAt !== null
                ? ` ${t('distribution.dueBy', {
                    date: new Date(myAcknowledgement.dueAt).toLocaleDateString(locale),
                  })}`
                : ''}
            </span>
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
              <span key={v.id} className="mr-3 inline-flex items-center gap-1">
                <Link
                  className="underline underline-offset-2"
                  href={`/${locale}/risk-assessments/${v.id}`}
                >
                  {v.personSpecificFor !== null
                    ? t(`personSpecific.badge.${v.personSpecificFor}`)
                    : v.title}
                </Link>
                {v.driftsFromParent ? (
                  <span
                    className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    title={t('personSpecific.driftChipTitle')}
                  >
                    {t('personSpecific.driftChip')}
                  </span>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
        {assessment.parentAssessmentId !== null && parentInfo !== null ? (
          <Link
            className="block text-sm text-muted-foreground underline underline-offset-2"
            href={`/${locale}/risk-assessments/${assessment.parentAssessmentId}`}
          >
            {t('personSpecific.parentLink', { title: parentInfo.title })}
          </Link>
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

        {/* Review + Distribution + Versions share one tabbed card. */}
        <Card>
          <CardContent className="space-y-4 pt-4">
            <Tabs
              value={panelTab}
              onValueChange={(v) =>
                setPanelTab(
                  v === 'distribution' ? 'distribution' : v === 'versions' ? 'versions' : 'review',
                )
              }
            >
              <TabsList>
                <TabsTrigger value="review">{t('review.sectionTitle')}</TabsTrigger>
                <TabsTrigger value="distribution">{t('distribution.sectionTitle')}</TabsTrigger>
                <TabsTrigger value="versions">{t('versions.sectionTitle')}</TabsTrigger>
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
            ) : panelTab === 'distribution' ? (
              <DistributionSection
                assessmentId={assessmentId}
                isActive={assessment.status === 'active'}
                acknowledgements={acknowledgements}
                canManage={canManage && assessment.archivedAt === null}
                onChanged={refresh}
                onShareHeadsUp={() => void shareViaHeadsUp()}
                sharing={sharing}
              />
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t('versions.hint')}</p>
                {versions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('versions.empty')}</p>
                ) : (
                  <ul className="divide-y">
                    {versions.map((v) => (
                      <li key={v.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                        <span className="font-mono text-xs">{`v${v.versionNumber}`}</span>
                        {v.versionNumber === assessment.currentVersion ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                            {t('versions.current')}
                          </span>
                        ) : null}
                        <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                          {t('versions.signOffLine', {
                            name: v.signedOffByName ?? v.signedOffBy,
                            date: new Date(v.signedOffAt).toLocaleDateString(locale),
                          })}
                          {v.actionsCreated > 0
                            ? ` · ${t('versions.actionsCreated', { count: v.actionsCreated })}`
                            : ''}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setViewVersion(v.versionNumber)}
                        >
                          {t('versions.view')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {events.length > 0 ? (
          <div className="rounded-md border bg-card p-3">
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

        {showPublishButton ? <div className="flex justify-end pb-4">{publishButton}</div> : null}
      </div>

      {/* Print record (M-4): readable size, one block per hazard, page
          breaks allowed between hazards, never inside one. */}
      <div className="hidden print:block px-6 py-4 text-[12px] leading-snug text-black">
        <div className="mb-1 flex items-baseline justify-between border-b-2 border-black pb-1">
          <span className="text-lg font-bold">{title}</span>
          <span className="font-mono">
            {assessment.referenceNumber}
            {assessment.currentVersion > 0 ? ` · v${assessment.currentVersion}` : ''}
          </span>
        </div>
        <p className="mb-1">
          {t(`type.${assessment.type}`)} · {t(`status.${assessment.status}`)}
          {siteName !== null ? ` · ${siteName}` : ''}
          {createdLine !== null ? ` · ${createdLine}` : ''}
          {assessment.nextReviewAt !== null
            ? ` · ${t('review.nextReviewLabel')}: ${new Date(assessment.nextReviewAt).toLocaleDateString(locale)}`
            : ''}
        </p>
        {assessment.activity.length > 0 ? (
          <p className="mb-2">
            <span className="font-semibold">{t('create.activityLabel')}: </span>
            {assessment.activity}
          </p>
        ) : null}
        <div className="space-y-2">
          {hazards.map((h, index) => {
            const initial = scoreFor(h.initialLikelihood, h.initialSeverity);
            const residual = scoreFor(h.residualLikelihood, h.residualSeverity);
            const initialBand = bandFor(h.initialLikelihood, h.initialSeverity, assessment.matrix);
            const residualBand = bandFor(
              h.residualLikelihood,
              h.residualSeverity,
              assessment.matrix,
            );
            return (
              <div key={h.id} className="rounded border border-black p-2 [break-inside:avoid]">
                <p className="font-bold">
                  {index + 1}. {h.hazard}
                  {h.harmDescription.length > 0 ? (
                    <span className="font-normal"> — {h.harmDescription}</span>
                  ) : null}
                </p>
                {h.affectedGroups.length > 0 ? (
                  <p>
                    <span className="font-semibold">{t('hazards.affectedLabel')} </span>
                    {h.affectedGroups
                      .map((g) =>
                        (PRESET_GROUPS as ReadonlyArray<string>).includes(g)
                          ? t(`hazards.groups.${g}` as never)
                          : g,
                      )
                      .join(', ')}
                  </p>
                ) : null}
                <p>
                  <span className="font-semibold">{t('hazards.initialRisk')}: </span>
                  {initial !== null ? `${initial} (${t(`band.${initialBand}`)})` : '—'}
                  {'  ·  '}
                  <span className="font-semibold">{t('hazards.residualRisk')}: </span>
                  {residual !== null ? `${residual} (${t(`band.${residualBand}`)})` : '—'}
                </p>
                {h.existingControls.length > 0 ? (
                  <p>
                    <span className="font-semibold">{t('hazards.existingControlsLabel')}: </span>
                    {h.existingControls}
                  </p>
                ) : null}
                {h.controls.length > 0 ? (
                  <ul className="ml-4 list-disc">
                    {h.controls.map((c) => (
                      <li key={c.id}>
                        [{t(`controls.tier.${c.tier}`)}] {c.description}
                        {c.status === 'planned' ? ` (${t('controls.statusPlanned')})` : ''}
                        {c.ppeJustification !== null && c.ppeJustification.length > 0
                          ? ` — ${t('controls.ppeJustificationLabel')}: ${c.ppeJustification}`
                          : ''}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {h.residualJustification.length > 0 ? (
                  <p className="italic">
                    {t('matrix.residualNoteLabel')}: {h.residualJustification}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="mt-3 border-t border-black pt-1">
          {t('publishConfirm.signOff')}
          {currentVersionRow !== undefined
            ? ` — ${t('versions.signOffLine', {
                name: currentVersionRow.signedOffByName ?? currentVersionRow.signedOffBy,
                date: new Date(currentVersionRow.signedOffAt).toLocaleDateString(locale),
              })} (v${currentVersionRow.versionNumber})`
            : createdByName !== null
              ? ` — ${createdByName}`
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
                openPublishDialog();
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
                openPublishDialog();
              }}
            >
              {t('titlePrompt.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* M-2/P-3: the sign-off dialog EVERY publish goes through — the
          attestation is an active tick, and each action-to-be gets an
          explicit owner + due date before anything goes live. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('publishConfirm.title')}</DialogTitle>
          </DialogHeader>
          {assessment.currentVersion > 0 ? (
            <p className="rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-900 dark:bg-orange-950/40 dark:text-orange-200">
              {hasUnpublishedChanges
                ? t('publishConfirm.republishNote', { version: nextVersionNumber })
                : t('publishConfirm.reactivateNote', { version: assessment.currentVersion })}
            </p>
          ) : null}
          {pendingPlanned.length > 0 ? (
            <>
              <p className="text-sm">
                {t('publishConfirm.actionsIntro', { count: pendingPlanned.length })}
              </p>
              <p className="text-xs text-muted-foreground">{t('publishConfirm.assignmentsHint')}</p>
              <ul className="max-h-72 space-y-2 overflow-y-auto">
                {pendingPlanned.map((c) => {
                  const a = assignments[c.id] ?? { assigneeIds: [], due: defaultDueDateInput() };
                  return (
                    <li key={c.id} className="space-y-2 rounded border px-3 py-2">
                      <span className="block text-sm">{c.description}</span>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-48 flex-1 space-y-1">
                          <Label className="text-xs">{t('publishConfirm.assigneeLabel')}</Label>
                          <GroupUserSelector
                            mode="users"
                            multiple={false}
                            value={a.assigneeIds}
                            onChange={(next) =>
                              setAssignments((prev) => ({
                                ...prev,
                                [c.id]: { assigneeIds: next, due: a.due },
                              }))
                            }
                            placeholder={t('publishConfirm.assigneePlaceholder')}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">{t('publishConfirm.dueLabel')}</Label>
                          <Input
                            type="date"
                            className="w-40"
                            value={a.due}
                            min={new Date().toISOString().slice(0, 10)}
                            onChange={(e) =>
                              setAssignments((prev) => ({
                                ...prev,
                                [c.id]: { assigneeIds: a.assigneeIds, due: e.target.value },
                              }))
                            }
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
            <Checkbox
              checked={signOffChecked}
              onCheckedChange={(v) => setSignOffChecked(v === true)}
              className="mt-0.5"
            />
            <span>{t('publishConfirm.signOff')}</span>
          </label>
          {!assignmentsComplete && pendingPlanned.length > 0 ? (
            <p className="text-xs font-medium text-orange-600 dark:text-orange-400">
              {t('publishConfirm.assignmentsIncomplete')}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              {t('publishConfirm.cancel')}
            </Button>
            <Button
              type="button"
              disabled={publish.isPending || !signOffChecked || !assignmentsComplete}
              onClick={submitPublish}
            >
              {publish.isPending ? t('publish.publishing') : t('publishConfirm.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VersionViewer
        assessmentId={assessmentId}
        versionNumber={viewVersion}
        open={viewVersion !== null}
        onOpenChange={(open) => {
          if (!open) setViewVersion(null);
        }}
      />
    </>
  );
}
