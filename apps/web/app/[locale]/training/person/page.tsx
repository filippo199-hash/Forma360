'use client';

/**
 * One person's wallet (TR-A4) — the induction / gate screen.
 *
 * Reached from a gap-list row or a matrix cell. Takes the person from the
 * URL so the view is linkable: standing at a client's gate, you send
 * someone a link to the card rather than describing it.
 */
import { useTranslations } from 'next-intl';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PersonWallet } from '../../../../src/components/training/person-wallet';
import { TrainingTabs } from '../../../../src/components/training/training-tabs';

function PersonWalletFromUrl() {
  const t = useTranslations('training.person');
  const params = useSearchParams();
  const routeParams = useParams<{ locale: string }>();
  const locale = routeParams.locale ?? 'en';
  const userId = params.get('userId');
  const name = params.get('name');
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* TR-B11 */}
      <TrainingTabs activeTab="me" locale={locale} />
      <PersonWallet
        {...(userId !== null ? { userId } : {})}
        {...(userId === null && name !== null ? { personName: name } : {})}
        heading={name ?? t('title')}
      />
    </div>
  );
}

export default function TrainingPersonPage() {
  return (
    <Suspense fallback={null}>
      <PersonWalletFromUrl />
    </Suspense>
  );
}
