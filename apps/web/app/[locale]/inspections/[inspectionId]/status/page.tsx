'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { SignaturePad } from '../../../../../src/components/inspections/signature-pad';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { ShareLinkDialog } from '../../../../../src/components/share-link-dialog';
import { useHasPermission } from '../../../../../src/lib/permissions-context';
import { trpc } from '../../../../../src/lib/trpc/client';

/**
 * Post-submit status view. Renders different content per inspection
 * status:
 *   - in_progress: back to conduct
 *   - awaiting_signatures: slot-by-slot sign links with collected-vs-remaining badge
 *   - awaiting_signature_workflow: template-level signature workflow — signer
 *     roster + inline signature pad when it is the caller's turn to sign
 *   - awaiting_approval: link to the approval detail if the caller can
 *     decide, otherwise a "pending" message
 *   - rejected: rejection reason + disabled reopen stub
 *   - completed: timestamp + disabled PDF export stub (PR 31)
 */
export default function InspectionStatusPage() {
  const params = useParams<{ locale: string; inspectionId: string }>();
  const inspectionId = params.inspectionId ?? '';
  const locale = params.locale ?? 'en';
  const t = useTranslations('inspections.statusPage');
  const tCommon = useTranslations('common');
  const tConduct = useTranslations('inspections.conduct');
  const canManage = useHasPermission('inspections.manage');

  const insp = trpc.inspections.get.useQuery(
    { inspectionId },
    { enabled: inspectionId.length === 26 },
  );
  const slots = trpc.signatures.listSlots.useQuery(
    { inspectionId },
    { enabled: inspectionId.length === 26 },
  );
  const utils = trpc.useUtils();
  const signWorkflow = trpc.inspections.signWorkflow.useMutation({
    onSuccess: () => {
      toast.success(t('workflowSignSuccess'));
      void utils.inspections.get.invalidate({ inspectionId });
    },
    onError: () => {
      toast.error(t('workflowSignError'));
    },
  });

  if (insp.isLoading || insp.data === undefined) {
    if (insp.error !== null && insp.error !== undefined) {
      return (
        <p role="alert" className="p-6 text-sm text-destructive">
          {insp.error.data?.code === 'NOT_FOUND' ? tConduct('notFound') : tCommon('error')}
        </p>
      );
    }
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { inspection, approvals, workflowSigners, viewerCanSignWorkflow, viewerSignerName } =
    insp.data;
  const status = inspection.status;
  const filled = slots.data?.signed.length ?? 0;
  const total = slots.data?.slots.length ?? 0;

  const workflowTotal = workflowSigners.length;
  const workflowFilled = workflowSigners.filter((s) => s.status === 'signed').length;

  const approvedRow = approvals.find((a) => a.decision === 'approved');

  return (
    <div className="space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{inspection.title}</p>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/${locale}/inspections`}>{t('back')}</Link>
        </Button>
      </header>

      <Card>
        <CardContent className="space-y-4 p-6">
          {status === 'in_progress' ? (
            <>
              <h2 className="text-base font-semibold">{t('inProgressTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('inProgressBody')}</p>
              <Button asChild>
                <Link href={`/${locale}/inspections/${inspection.id}`}>{t('continueButton')}</Link>
              </Button>
            </>
          ) : null}

          {status === 'awaiting_signatures' ? (
            <>
              <h2 className="text-base font-semibold">{t('awaitingSignaturesTitle')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('awaitingSignaturesBody', { filled, total })}
              </p>
              <div className="space-y-2">
                {(slots.data?.slots ?? []).map((slot) => {
                  const signed = (slots.data?.signed ?? []).some(
                    (s) => s.slotId === slot.itemId && s.slotIndex === slot.slotIndex,
                  );
                  return (
                    <div
                      key={`${slot.itemId}-${slot.slotIndex}`}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                      <div className="space-y-0.5 text-sm">
                        <p className="font-medium">
                          {t('signSlot', { index: slot.slotIndex + 1 })}
                        </p>
                        {slot.label !== undefined ? (
                          <p className="text-xs text-muted-foreground">{slot.label}</p>
                        ) : null}
                      </div>
                      {signed ? (
                        <span className="text-xs font-medium text-green-700 dark:text-green-400">
                          {t('signedBadge')}
                        </span>
                      ) : (
                        <Button size="sm" variant="outline" asChild>
                          <Link
                            href={`/${locale}/inspections/${inspection.id}/signatures/${slot.slotIndex}`}
                            aria-label={t('signSlot', { index: slot.slotIndex + 1 })}
                          >
                            {t('signSlotCta')}
                          </Link>
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}

          {status === 'awaiting_signature_workflow' ? (
            <>
              <h2 className="text-base font-semibold">{t('awaitingWorkflowTitle')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('awaitingWorkflowBody', { filled: workflowFilled, total: workflowTotal })}
              </p>
              <ul className="space-y-2">
                {workflowSigners.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                  >
                    <div className="min-w-0 space-y-0.5 text-sm">
                      <p className="font-medium">
                        {s.signerName ?? t('workflowSignerLabel', { position: s.position + 1 })}
                      </p>
                      {s.signedAt !== null ? (
                        <p className="text-xs text-muted-foreground">
                          {t('workflowSignedAt', {
                            time: new Date(s.signedAt).toLocaleString(),
                          })}
                        </p>
                      ) : null}
                    </div>
                    {s.status === 'signed' ? (
                      <span className="text-xs font-medium text-green-700 dark:text-green-400">
                        {t('workflowStatusSigned')}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">
                        {t('workflowStatusPending')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {viewerCanSignWorkflow ? (
                <div className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-semibold">{t('workflowYourTurnTitle')}</h3>
                  <p className="text-sm text-muted-foreground">{t('workflowYourTurnBody')}</p>
                  <SignaturePad
                    saving={signWorkflow.isPending}
                    {...(viewerSignerName !== null ? { defaultName: viewerSignerName } : {})}
                    onSave={({ signatureData }) => {
                      signWorkflow.mutate({ inspectionId, signatureData });
                    }}
                  />
                </div>
              ) : (
                <div className="space-y-1 border-t pt-4">
                  <h3 className="text-sm font-semibold">{t('workflowWaitingTitle')}</h3>
                  <p className="text-sm text-muted-foreground">{t('workflowWaitingBody')}</p>
                </div>
              )}
            </>
          ) : null}

          {status === 'awaiting_approval' ? (
            <>
              <h2 className="text-base font-semibold">{t('awaitingApprovalTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('awaitingApprovalBody')}</p>
              {canManage ? (
                <Button asChild>
                  <Link href={`/${locale}/approvals/${inspection.id}`}>{t('openApproval')}</Link>
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">{t('awaitingApprovalPending')}</p>
              )}
            </>
          ) : null}

          {status === 'completed' ? (
            <>
              <h2 className="text-base font-semibold">{t('completedTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('completedBody')}</p>
              {inspection.completedAt !== null ? (
                <p className="text-xs text-muted-foreground">
                  {t('completedAt', {
                    time: new Date(inspection.completedAt).toLocaleString(),
                  })}
                </p>
              ) : null}
              {approvedRow !== undefined ? (
                <p className="text-xs text-muted-foreground">
                  {t('approvedBy', { user: approvedRow.approverUserId })}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href={`/${locale}/inspections/${inspection.id}/report`}>
                    {t('viewReportButton')}
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <a href={`/api/exports/pdf?inspectionId=${inspection.id}`}>{t('pdfButton')}</a>
                </Button>
                <Button variant="outline" asChild>
                  <a href={`/api/exports/docx?inspectionId=${inspection.id}`}>{t('docxButton')}</a>
                </Button>
                <ShareLinkDialog inspectionId={inspection.id} />
              </div>
            </>
          ) : null}

          {status === 'rejected' ? (
            <>
              <h2 className="text-base font-semibold">{t('rejectedTitle')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('rejectedBody', { reason: inspection.rejectedReason ?? '' })}
              </p>
              {/* TODO: reopen flow lands with the wider rejections PR. */}
              <Button variant="outline" disabled>
                {t('reopenButton')}
              </Button>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
