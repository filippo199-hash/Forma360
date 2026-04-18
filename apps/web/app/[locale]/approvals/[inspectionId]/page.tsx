'use client';

import type { TemplateContent } from '@forma360/shared/template-schema';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useReducer } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { Responses } from '../../../../src/components/inspections/conduct-state';
import { InspectionReview } from '../../../../src/components/inspections/inspection-review';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../src/components/ui/dialog';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { trpc } from '../../../../src/lib/trpc/client';

/**
 * Approval detail. Renders the inspection read-only, shows the collected
 * signatures, and exposes Approve / Reject buttons.
 *
 *   - Approve: comment optional.
 *   - Reject: comment required (client-validated; server enforces min(1)).
 *
 * Both mutations invalidate the list + detail queries and navigate back to
 * the queue on success.
 */

type DialogState =
  | { kind: 'closed' }
  | { kind: 'approve'; comment: string }
  | { kind: 'reject'; comment: string };

type DialogAction =
  | { type: 'open-approve' }
  | { type: 'open-reject' }
  | { type: 'set-comment'; value: string }
  | { type: 'close' };

function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case 'open-approve':
      return { kind: 'approve', comment: '' };
    case 'open-reject':
      return { kind: 'reject', comment: '' };
    case 'set-comment':
      if (state.kind === 'closed') return state;
      return { ...state, comment: action.value };
    case 'close':
      return { kind: 'closed' };
  }
}

export default function ApprovalDetailPage() {
  const params = useParams<{ locale: string; inspectionId: string }>();
  const router = useRouter();
  const locale = params.locale ?? 'en';
  const inspectionId = params.inspectionId ?? '';
  const t = useTranslations('approvals');
  const tCommon = useTranslations('common');
  const tConduct = useTranslations('inspections.conduct');

  const insp = trpc.inspections.get.useQuery(
    { inspectionId },
    { enabled: inspectionId.length === 26 },
  );
  const utils = trpc.useUtils();

  const [dialog, dispatch] = useReducer(dialogReducer, { kind: 'closed' });

  const approve = trpc.approvals.approve.useMutation({
    onSuccess: () => {
      toast.success(t('approvedToast'));
      void utils.inspections.list.invalidate();
      void utils.inspections.get.invalidate({ inspectionId });
      router.push(`/${locale}/approvals`);
    },
    onError: () => toast.error(t('decisionError')),
  });

  const reject = trpc.approvals.reject.useMutation({
    onSuccess: () => {
      toast.success(t('rejectedToast'));
      void utils.inspections.list.invalidate();
      void utils.inspections.get.invalidate({ inspectionId });
      router.push(`/${locale}/approvals`);
    },
    onError: () => toast.error(t('decisionError')),
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

  const { inspection, version, signatures } = insp.data;
  const content = version.content as TemplateContent;
  const responses = inspection.responses as Responses;
  const canDecide = inspection.status === 'awaiting_approval';
  const pending = approve.isPending || reject.isPending;

  function submitApprove() {
    if (dialog.kind !== 'approve') return;
    const comment = dialog.comment.trim();
    approve.mutate({
      inspectionId,
      ...(comment.length > 0 ? { comment } : {}),
    });
  }

  function submitReject() {
    if (dialog.kind !== 'reject') return;
    const comment = dialog.comment.trim();
    if (comment.length === 0) {
      toast.error(t('rejectReasonRequired'));
      return;
    }
    reject.mutate({ inspectionId, comment });
  }

  return (
    <div className="space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{inspection.title}</h1>
          {inspection.documentNumber !== null ? (
            <p className="font-mono text-xs text-muted-foreground">{inspection.documentNumber}</p>
          ) : null}
        </div>
        <Button variant="outline" asChild>
          <Link href={`/${locale}/approvals`}>{t('backToQueue')}</Link>
        </Button>
      </header>

      <InspectionReview content={content} responses={responses} signatures={signatures} />

      {signatures.length > 0 ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-base font-semibold">{t('signaturesHeading')}</h2>
            <ul className="space-y-3">
              {signatures.map((sig) => (
                <li key={sig.id} className="space-y-1 rounded-md border p-3">
                  {/* Signature data is a data-url PNG captured by the pad. */}
                  <img
                    src={sig.signatureData}
                    alt={sig.signerName}
                    className="max-h-32 rounded border bg-white"
                  />
                  <p className="text-sm">
                    {sig.signerName}
                    {sig.signerRole !== null ? ` — ${sig.signerRole}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('signedAt', { time: new Date(sig.signedAt).toLocaleString() })}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {canDecide ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => dispatch({ type: 'open-approve' })} disabled={pending}>
            {t('approveButton')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => dispatch({ type: 'open-reject' })}
            disabled={pending}
          >
            {t('rejectButton')}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t('notAwaiting', { status: inspection.status })}
        </p>
      )}

      <Dialog
        open={dialog.kind === 'approve'}
        onOpenChange={(open) => (!open ? dispatch({ type: 'close' }) : undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('approveDialogTitle')}</DialogTitle>
            <DialogDescription>{t('approveDialogBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="approve-comment">
              {t('commentOptional')}
            </label>
            <Textarea
              id="approve-comment"
              value={dialog.kind === 'approve' ? dialog.comment : ''}
              onChange={(e) => dispatch({ type: 'set-comment', value: e.target.value })}
              placeholder={t('commentPlaceholder')}
              rows={3}
              maxLength={2000}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => dispatch({ type: 'close' })}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={submitApprove} disabled={approve.isPending}>
              {t('approveConfirmCta')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog.kind === 'reject'}
        onOpenChange={(open) => (!open ? dispatch({ type: 'close' }) : undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('rejectDialogTitle')}</DialogTitle>
            <DialogDescription>{t('rejectDialogBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="reject-comment">
              {t('commentRequired')}
            </label>
            <Textarea
              id="reject-comment"
              value={dialog.kind === 'reject' ? dialog.comment : ''}
              onChange={(e) => dispatch({ type: 'set-comment', value: e.target.value })}
              placeholder={t('commentPlaceholder')}
              rows={3}
              maxLength={2000}
              required
            />
            {dialog.kind === 'reject' && dialog.comment.trim().length === 0 ? (
              <p className="text-xs text-destructive">{t('rejectReasonRequired')}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => dispatch({ type: 'close' })}>
              {tCommon('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={submitReject}
              disabled={
                reject.isPending ||
                (dialog.kind === 'reject' && dialog.comment.trim().length === 0)
              }
            >
              {t('rejectConfirmCta')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
