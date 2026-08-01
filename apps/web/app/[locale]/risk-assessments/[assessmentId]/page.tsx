'use client';

/**
 * Risk assessment detail — the HSE five-step editor. Sections: hazards
 * (steps 1–3 per hazard via HazardCard), record/publish (step 4 — enforces
 * scoring + the PPE-only justification rule server-side and surfaces the
 * specific error), review (step 5) and distribution/acknowledgement.
 * Person-specific variants are prompted when the affected groups call for
 * them and created as linked drafts.
 */
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { HazardCard } from '../../../../src/components/risk-assessments/hazard-card';
import { DistributionSection } from '../../../../src/components/risk-assessments/distribution-section';
import { ReviewSection } from '../../../../src/components/risk-assessments/review-section';
import { Button } from '../../../../src/components/ui/button';
import { Input } from '../../../../src/components/ui/input';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

const PUBLISH_ERRORS = new Set(['no-hazards', 'unscored-hazards', 'ppe-only-needs-justification']);

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
  const [newHazard, setNewHazard] = useState('');

  const refresh = (): void => {
    void utils.riskAssessments.get.invalidate({ assessmentId });
    void utils.riskAssessments.list.invalidate();
  };

  const addHazard = trpc.riskAssessments.addHazard.useMutation({
    onSuccess: () => {
      setNewHazard('');
      refresh();
    },
    onError: () => toast.error(t('saveError')),
  });
  const publish = trpc.riskAssessments.publish.useMutation({
    onSuccess: (res) => {
      toast.success(t('publish.successToast'));
      if (res.actionsCreated > 0) {
        toast.success(t('publish.actionsCreated', { count: res.actionsCreated }));
      }
      refresh();
    },
    onError: (err) => {
      const key = PUBLISH_ERRORS.has(err.message) ? err.message : 'generic';
      toast.error(t(`publish.errors.${key}` as never));
    },
  });
  const archive = trpc.riskAssessments.archive.useMutation({
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

  const { assessment, hazards, reviews, acknowledgements, linkedVariants, myAcknowledgement } =
    query.data;
  const editable = canManage && assessment.archivedAt === null;
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
  const allScored =
    hazards.length > 0 &&
    hazards.every(
      (h) =>
        h.initialLikelihood !== null &&
        h.initialSeverity !== null &&
        h.residualLikelihood !== null &&
        h.residualSeverity !== null,
    );
  const ppeOk = hazards.every((h) => {
    if (h.controls.length === 0) return true;
    const allPpe = h.controls.every((c) => c.tier === 'ppe');
    const justified = h.controls.some((c) => (c.ppeJustification ?? '').trim().length > 0);
    return !allPpe || justified;
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <Link
        href={`/${locale}/risk-assessments`}
        className="text-sm text-muted-foreground underline-offset-2 hover:underline"
      >
        ← {t('backToList')}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{assessment.title}</h1>
            <span className="font-mono text-xs text-muted-foreground">
              {assessment.referenceNumber}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {t(`type.${assessment.type}`)}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {t(`status.${assessment.status}`)}
            </span>
            {assessment.personSpecificFor !== null ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {t(`personSpecific.badge.${assessment.personSpecificFor}`)}
              </span>
            ) : null}
          </div>
          {assessment.activity.length > 0 ? (
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{assessment.activity}</p>
          ) : null}
        </div>
        {editable ? (
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              disabled={publish.isPending}
              onClick={() => publish.mutate({ assessmentId })}
            >
              {publish.isPending
                ? t('publish.publishing')
                : assessment.status === 'active'
                  ? t('publish.republish')
                  : t('publish.button')}
            </Button>
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
          </div>
        ) : null}
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
                onClick={() => createVariant.mutate({ assessmentId, kind: 'new_expectant_mother' })}
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
          {t('personSpecific.parentLink', { title: assessment.title })}
        </Link>
      ) : null}

      <ol className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <li>{t('steps.hazards')}</li>
        <li>{t('steps.people')}</li>
        <li>{t('steps.evaluate')}</li>
        <li>{t('steps.record')}</li>
        <li>{t('steps.review')}</li>
      </ol>

      {editable ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-2 text-xs">
          <span className="font-medium">{t('readiness.title')}</span>
          {[
            { ok: hazards.length > 0, label: t('readiness.hazards') },
            { ok: allScored, label: t('readiness.scored') },
            { ok: ppeOk, label: t('readiness.ppe') },
          ].map((item) => (
            <span
              key={item.label}
              className={
                item.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
              }
            >
              {item.ok ? '✓' : '○'} {item.label}
            </span>
          ))}
        </div>
      ) : null}

      <div>
        <h2 className="text-base font-semibold">{t('hazards.sectionTitle')}</h2>
        <p className="max-w-3xl text-xs text-muted-foreground">{t('hazards.sectionHint')}</p>
      </div>

      {editable ? (
        <div className="flex gap-2">
          <Input
            value={newHazard}
            placeholder={t('hazards.quickAddPlaceholder')}
            onChange={(e) => setNewHazard(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newHazard.trim().length > 0 && !addHazard.isPending) {
                e.preventDefault();
                addHazard.mutate({
                  assessmentId,
                  hazard: newHazard.trim(),
                  harmDescription: '',
                  affectedGroups: ['employees'],
                  existingControls: '',
                });
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={newHazard.trim().length === 0 || addHazard.isPending}
            onClick={() =>
              addHazard.mutate({
                assessmentId,
                hazard: newHazard.trim(),
                harmDescription: '',
                affectedGroups: ['employees'],
                existingControls: '',
              })
            }
          >
            {t('hazards.add')}
          </Button>
        </div>
      ) : null}

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
              presetGroups={[
                'employees',
                'cleaners',
                'contractors',
                'visitors',
                'young_persons',
                'new_expectant_mothers',
                'lone_workers',
                'members_of_public',
              ]}
              onChanged={refresh}
            />
          ))}
        </div>
      )}

      <ReviewSection
        assessmentId={assessmentId}
        reviewFrequencyMonths={assessment.reviewFrequencyMonths}
        nextReviewAt={assessment.nextReviewAt}
        lastReviewedAt={assessment.lastReviewedAt}
        reviews={reviews}
        canManage={editable}
        onChanged={refresh}
      />

      <DistributionSection
        assessmentId={assessmentId}
        isActive={assessment.status === 'active'}
        acknowledgements={acknowledgements}
        canManage={editable}
        onChanged={refresh}
      />
    </div>
  );
}
