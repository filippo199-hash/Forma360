'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { SignaturePad } from '../../../../../../src/components/inspections/signature-pad';
import { Button } from '../../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../../src/components/ui/card';
import { Skeleton } from '../../../../../../src/components/ui/skeleton';
import { trpc } from '../../../../../../src/lib/trpc/client';

/**
 * Focused mobile-first page for signing a single slot. Loads the inspection
 * + pinned version + slot list, validates that the slotIndex is in range
 * and not yet signed, and presents the signature-pad. On success the user
 * sees the remaining unsigned slots (or returns to status if all done).
 *
 * T-E20 conflict (double-sign race) is translated into a toast + redirect
 * back to status — the server is authoritative.
 */
export default function SignSlotPage() {
  const params = useParams<{ locale: string; inspectionId: string; slotIndex: string }>();
  const router = useRouter();
  const locale = params.locale ?? 'en';
  const inspectionId = params.inspectionId ?? '';
  const slotIndexNum = Number.parseInt(params.slotIndex ?? '', 10);
  const t = useTranslations('inspections.signatures');
  const tCommon = useTranslations('common');
  const tConduct = useTranslations('inspections.conduct');
  const tStatus = useTranslations('inspections.statusPage');

  const statusHref = `/${locale}/inspections/${inspectionId}/status`;

  const insp = trpc.inspections.get.useQuery(
    { inspectionId },
    { enabled: inspectionId.length === 26 },
  );
  const slots = trpc.signatures.listSlots.useQuery(
    { inspectionId },
    { enabled: inspectionId.length === 26 },
  );
  const utils = trpc.useUtils();

  const matchedSlot = useMemo(() => {
    if (slots.data === undefined) return undefined;
    return slots.data.slots.find((s) => s.slotIndex === slotIndexNum);
  }, [slots.data, slotIndexNum]);

  const alreadySigned = useMemo(() => {
    if (slots.data === undefined) return false;
    return slots.data.signed.some((s) => s.slotIndex === slotIndexNum);
  }, [slots.data, slotIndexNum]);

  // Redirect if slot is already signed; the server is still authoritative
  // but this trims a dead-end UI.
  useEffect(() => {
    if (!slots.isSuccess) return;
    if (alreadySigned) {
      toast.info(t('alreadySigned'));
      router.replace(statusHref);
    }
  }, [slots.isSuccess, alreadySigned, router, statusHref, t]);

  const sign = trpc.signatures.sign.useMutation({
    onSuccess: () => {
      toast.success(t('saveSuccess'));
      void utils.signatures.listSlots.invalidate({ inspectionId });
      void utils.inspections.get.invalidate({ inspectionId });
      // Refetch and decide next step in the subsequent render.
    },
    onError: (err) => {
      if (err.data?.code === 'CONFLICT') {
        toast.info(t('alreadySigned'));
        router.replace(statusHref);
        return;
      }
      toast.error(t('saveError'));
    },
  });

  if (Number.isNaN(slotIndexNum) || slotIndexNum < 0) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        {t('invalidSlot')}
      </p>
    );
  }

  if (insp.isLoading || slots.isLoading || insp.data === undefined || slots.data === undefined) {
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

  if (matchedSlot === undefined) {
    return (
      <div className="space-y-4 p-6">
        <p role="alert" className="text-sm text-destructive">
          {t('invalidSlot')}
        </p>
        <Button variant="outline" asChild>
          <Link href={statusHref}>{tStatus('back')}</Link>
        </Button>
      </div>
    );
  }

  const unsignedRemaining = slots.data.slots.filter(
    (s) => !slots.data.signed.some((x) => x.slotIndex === s.slotIndex) && s.slotIndex !== slotIndexNum,
  );

  const justSigned = sign.isSuccess;

  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{inspection.title}</p>
      </header>

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {t('slotHeading', { index: slotIndexNum + 1 })}
            </p>
            {matchedSlot.label !== undefined ? (
              <p className="text-xs text-muted-foreground">{matchedSlot.label}</p>
            ) : null}
          </div>

          {justSigned ? (
            <div className="space-y-3">
              <p className="rounded-md bg-green-100 px-3 py-2 text-sm text-green-900 dark:bg-green-900/40 dark:text-green-100">
                {t('savedBanner')}
              </p>
              {unsignedRemaining.length === 0 ? (
                <Button asChild>
                  <Link href={statusHref}>{t('allDoneCta')}</Link>
                </Button>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t('remainingHeading')}</p>
                  <ul className="space-y-2">
                    {unsignedRemaining.map((s) => (
                      <li
                        key={s.slotIndex}
                        className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                      >
                        <div className="min-w-0 space-y-0.5 text-sm">
                          <p className="font-medium">
                            {t('slotHeading', { index: s.slotIndex + 1 })}
                          </p>
                          {s.label !== undefined ? (
                            <p className="truncate text-xs text-muted-foreground">{s.label}</p>
                          ) : null}
                        </div>
                        <Button size="sm" asChild>
                          <Link
                            href={`/${locale}/inspections/${inspectionId}/signatures/${s.slotIndex}`}
                          >
                            {t('signNext')}
                          </Link>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Button variant="outline" asChild>
                <Link href={statusHref}>{tStatus('back')}</Link>
              </Button>
            </div>
          ) : (
            <SignaturePad
              saving={sign.isPending}
              onSave={({ signatureData, signerName, signerRole }) => {
                sign.mutate({
                  inspectionId,
                  slotIndex: slotIndexNum,
                  slotId: matchedSlot.itemId,
                  signatureData,
                  signerName,
                  ...(signerRole !== undefined ? { signerRole } : {}),
                });
              }}
            />
          )}
        </CardContent>
      </Card>

      {!justSigned ? (
        <Button variant="ghost" asChild>
          <Link href={statusHref}>{tStatus('back')}</Link>
        </Button>
      ) : null}
    </div>
  );
}
