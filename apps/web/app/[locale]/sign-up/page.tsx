import { setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignUpCard } from '../../../src/components/auth/sign-up-card';
import { auth } from '../../../src/server/auth';

/**
 * Self-service sign-up entry point. Wraps the client SignUpCard in the
 * same centered card layout the sign-in page uses. Signed-in callers
 * are bounced straight into the app — sign-up never makes sense while
 * already authenticated.
 */
export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (session !== null) {
    redirect(`/${locale}/templates`);
  }

  return (
    <section className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-6xl items-center justify-center px-4 py-16">
      <SignUpCard />
    </section>
  );
}
