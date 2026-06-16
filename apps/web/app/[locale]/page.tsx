import { setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignInCard } from '../../src/components/home/sign-in-card';
import { auth } from '../../src/server/auth';

/**
 * Home page. Signs-in users are redirected to the AI assistant which is
 * the default landing page. Unauthenticated users see the sign-in form.
 */
export default async function LocaleHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (session !== null) {
    redirect(`/${locale}/ai`);
  }

  return (
    <section className="mx-auto flex max-w-6xl items-center justify-center px-4 py-16">
      <SignInCard />
    </section>
  );
}
