'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PenLine } from 'lucide-react';
import { Button } from '../ui/button';
import { trpc } from '../../lib/trpc/client';

/**
 * "Awaiting your signature" call-out for the top of the Inspections list.
 *
 * Surfaces `inspections.listAwaitingMySignature` — the inspections the
 * caller must sign right now (sequential: only when it is their turn;
 * parallel: every pending row). Each item deep-links to the status page,
 * where the signature pad lives (the workflow status branch added with the
 * B6 fix). Renders nothing when the queue is empty, so it stays invisible
 * for users who are never signatories.
 */
export function AwaitingSignatureBanner() {
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const t = useTranslations('inspections.awaitingSignature');
  const q = trpc.inspections.listAwaitingMySignature.useQuery();

  const items = q.data ?? [];
  if (items.length === 0) return null;

  return (
    <section
      aria-label={t('heading')}
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10"
    >
      <div className="mb-3 flex items-center gap-2">
        <PenLine className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
          {t('title', { count: items.length })}
        </h2>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.inspectionId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2"
          >
            <div className="min-w-0 space-y-0.5 text-sm">
              <p className="truncate font-medium">{item.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {t('requestedBy', { name: item.requesterName })}
              </p>
            </div>
            <Button size="sm" asChild>
              <Link href={`/${locale}/inspections/${item.inspectionId}/status`}>{t('signCta')}</Link>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
