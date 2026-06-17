import { setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignInCard } from '../../../src/components/home/sign-in-card';
import { auth } from '../../../src/server/auth';

/**
 * Passwordless sign-in entry point. The public homepage links here. Signed-in
 * callers are bounced straight into the app.
 */
export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (session !== null) {
    redirect(`/${locale}/templates`);
  }

  return (
    <section className="mx-auto flex max-w-6xl items-center justify-center px-4 py-16">
      <SignInCard />
    </section>
  );
}
