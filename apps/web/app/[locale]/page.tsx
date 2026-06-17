import { setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { MarketingHero } from '../../src/components/home/marketing-hero';
import { SignInCard } from '../../src/components/home/sign-in-card';
import { auth } from '../../src/server/auth';

/**
 * Home page. Signed-in users are redirected to the AI assistant (the default
 * in-app landing page). Signed-out visitors see a public marketing hero
 * describing the platform and its WhatsApp assistant, followed by the
 * passwordless sign-in card.
 */
export default async function LocaleHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (session !== null) {
    redirect(`/${locale}/ai`);
  }

  return (
    <div className="pb-20">
      <MarketingHero locale={locale} />
      <section className="mx-auto mt-16 flex max-w-6xl items-center justify-center px-4">
        <SignInCard />
      </section>
    </div>
  );
}
