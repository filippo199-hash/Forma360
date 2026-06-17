import { setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { MarketingHero } from '../../src/components/home/marketing-hero';
import {
  CtaBand,
  IndustriesStrip,
  Modules,
  Stats,
  WhatsAppSpotlight,
} from '../../src/components/home/marketing-sections';
import { auth } from '../../src/server/auth';

/**
 * Public home page — the marketing landing page for everyone. It never
 * redirects signed-in users into the app; the hero offers an "Open the app"
 * CTA instead. Sign-in lives at /[locale]/sign-in (linked from the header).
 */
export default async function LocaleHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const isSignedIn = session !== null;

  return (
    <>
      <MarketingHero locale={locale} isSignedIn={isSignedIn} />
      <IndustriesStrip />
      <Modules />
      <WhatsAppSpotlight />
      <Stats />
      <CtaBand locale={locale} />
    </>
  );
}
