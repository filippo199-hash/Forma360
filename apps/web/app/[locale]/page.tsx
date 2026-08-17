import { setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { MarketingHero } from '../../src/components/home/marketing-hero';
import {
  CtaBand,
  DocsTeaser,
  GoldenThread,
  HowItWorks,
  ModulesShowcase,
  PricingSection,
  TrustStrip,
  WhatsAppSpotlight,
} from '../../src/components/home/marketing-sections';
import { auth } from '../../src/server/auth';

/**
 * Home page. Anonymous visitors get the marketing landing page; signed-in
 * users are sent straight into the app — "For me" (the personal work
 * queue) is the default landing surface. Sign-in lives at /[locale]/sign-in.
 */
export default async function LocaleHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (session !== null) {
    redirect(`/${locale}/my-work`);
  }

  return (
    <>
      <MarketingHero locale={locale} isSignedIn={false} />
      <TrustStrip />
      <ModulesShowcase locale={locale} />
      <GoldenThread />
      <WhatsAppSpotlight />
      <HowItWorks />
      <PricingSection locale={locale} />
      <DocsTeaser locale={locale} />
      <CtaBand locale={locale} />
    </>
  );
}
