import { setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { InviteAcceptCard } from '../../../../src/components/auth/invite-accept-card';
import { auth } from '../../../../src/server/auth';

/**
 * Invite acceptance entry point. Server-only logic here is small:
 *
 *   1. Set the request locale so client `useTranslations` works.
 *   2. If the caller is already signed in AS THE INVITED EMAIL we
 *      bounce them into the app — they don't need to accept again.
 *      We deliberately allow the page to render when they're signed
 *      in to a DIFFERENT account so they can see the "you need to
 *      sign out first" affordance via the form (the mutation will
 *      reject; a future PR can refine this UX).
 *
 * The active flow runs entirely client-side via the InviteAcceptCard
 * — it queries `auth.getInviteDetails`, renders the right state, and
 * calls `auth.acceptInvite` + better-auth on submit.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (session !== null) {
    // We don't know which email the invite is for here without an
    // extra DB roundtrip; the safer default is to send signed-in
    // callers home rather than risk silently overwriting their
    // current session.
    redirect(`/${locale}/templates`);
  }

  return (
    <section className="mx-auto flex max-w-6xl items-center justify-center px-4 py-16">
      <InviteAcceptCard token={token} />
    </section>
  );
}
