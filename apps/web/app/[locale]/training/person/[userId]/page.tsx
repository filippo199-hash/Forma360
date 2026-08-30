'use client';

/**
 * One person's wallet, addressed by user id (TR-B3).
 *
 * The canonical, linkable form — and the URL Cmd-K resolves to. The
 * command palette builds `basePath/<id>`, so the training category needs
 * a real `/training/person/<userId>` segment; before this it pointed at
 * `/training/requirements/<id>`, which was never a route, so every
 * training hit dead-ended in a 404.
 *
 * The sibling `?name=` page still serves people with no account, who
 * have no id to put in a path.
 */
import { useParams } from 'next/navigation';
import { PersonWallet } from '../../../../../src/components/training/person-wallet';

export default function TrainingPersonByIdPage() {
  const params = useParams<{ locale: string; userId: string }>();
  return (
    <div className="space-y-4 sm:space-y-6">
      <PersonWallet userId={params.userId} backHref={`/${params.locale}/training`} />
    </div>
  );
}
