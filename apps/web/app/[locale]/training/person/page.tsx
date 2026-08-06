'use client';

/**
 * One person's wallet (TR-A4) — the induction / gate screen.
 *
 * Reached from a gap-list row or a matrix cell. Takes the person from the
 * URL so the view is linkable: standing at a client's gate, you send
 * someone a link to the card rather than describing it.
 */
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PersonWallet } from '../../../../src/components/training/person-wallet';

function PersonWalletFromUrl() {
  const t = useTranslations('training.person');
  const params = useSearchParams();
  const userId = params.get('userId');
  const name = params.get('name');
  return (
    <PersonWallet
      {...(userId !== null ? { userId } : {})}
      {...(userId === null && name !== null ? { personName: name } : {})}
      heading={name ?? t('title')}
    />
  );
}

export default function TrainingPersonPage() {
  return (
    <Suspense fallback={null}>
      <PersonWalletFromUrl />
    </Suspense>
  );
}
