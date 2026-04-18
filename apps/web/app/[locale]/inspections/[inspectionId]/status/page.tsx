'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { trpc } from '../../../../../src/lib/trpc/client';

/**
 * Post-submit status view. Renders different content per inspection
 * status and links back to the conduct view / signature collection.
 */
export default function InspectionStatusPage() {
  const params = useParams<{ locale: string; inspectionId: string }>();
  const inspectionId = params.inspectionId ?? '';
  const locale = params.locale ?? 'en';
  const t = useTranslations('inspections.statusPage');
  const tCommon = useTranslations('common');
  const tConduct = useTranslations('inspections.conduct');

  const insp = trpc.inspections.get.useQuery(
    { inspectionId },
    { enabled: inspectionId.length === 26 },
  );
  const slots = trpc.signatures.listSlots.useQuery(
    { inspectionId },
    { enabled: inspectionId.length === 26 },
  );

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

  const { inspection } = insp.data;
  const status = inspection.status;
  const filled = slots.data?.signed.length ?? 0;
  const total = slots.data?.slots.length ?? 0;

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
                <Link href={`/${locale}/inspections/${inspection.id}`}>
                  {t('continueButton')}
                </Link>
              </Button>
            </>
          ) : null}

          {status === 'awaiting_signatures' ? (
            <>
              <h2 className="text-base font-semibold">{t('awaitingSignaturesTitle')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('awaitingSignaturesBody', { filled, total })}
              </p>
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
                        ✓
                      </span>
                    ) : (
                      <Button size="sm" variant="outline" asChild>
                        <Link
                          href={`/${locale}/inspections/${inspection.id}`}
                          aria-label={t('signSlot', { index: slot.slotIndex + 1 })}
                        >
                          {t('signSlot', { index: slot.slotIndex + 1 })}
                        </Link>
                      </Button>
                    )}
                  </div>
                );
              })}
            </>
          ) : null}

          {status === 'awaiting_approval' ? (
            <>
              <h2 className="text-base font-semibold">{t('awaitingApprovalTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('awaitingApprovalBody')}</p>
            </>
          ) : null}

          {status === 'completed' ? (
            <>
              <h2 className="text-base font-semibold">{t('completedTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('completedBody')}</p>
              {/* TODO PR 31: wire real PDF export. Stub button disabled so
                  the shape is stable. */}
              <Button disabled title={t('pdfComingSoon')}>
                {t('pdfButton')}
              </Button>
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
