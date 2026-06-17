import { setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { MarketingHero } from '../../src/components/home/marketing-hero';
import { SignInCard } from '../../src/components/home/sign-in-card';
import { auth } from '../../src/server/auth';

/**
 * Public home page — the marketing landing page for everyone. It does NOT
 * redirect signed-in users into the app; instead the hero offers an
 * "Open the app" call to action. Signed-out visitors additionally see the
 * passwordless sign-in card below the hero.
 */
export default async function LocaleHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const isSignedIn = session !== null;

  return (
    <div className="pb-20">
      <MarketingHero locale={locale} isSignedIn={isSignedIn} />
      {isSignedIn ? null : (
        <section className="mx-auto mt-16 flex max-w-6xl items-center justify-center px-4">
          <SignInCard />
        </section>
      )}
    </div>
  );
}
