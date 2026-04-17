import { setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { SignInCard } from '../../src/components/home/sign-in-card';
import { WelcomeCard } from '../../src/components/home/welcome-card';
import { auth } from '../../src/server/auth';

/**
 * Home page. Renders the sign-in form when the request has no session,
 * otherwise the welcome card that pulls session fields from health.me.
 *
 * The session lookup happens server-side so the initial HTML contains the
 * right card — no post-hydration flash for the most common path.
 */
export default async function LocaleHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const isSignedIn = session !== null;

  return (
    <section className="mx-auto flex max-w-6xl items-center justify-center px-4 py-16">
      {isSignedIn ? <WelcomeCard /> : <SignInCard />}
    </section>
  );
}
