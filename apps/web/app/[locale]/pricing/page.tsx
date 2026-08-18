import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { CtaBand } from '../../../src/components/home/marketing-sections';
import { PricingPage } from '../../../src/components/marketing/pricing-page';
import { PRICING } from '../../../src/content/site';

export const metadata: Metadata =
  PRICING === null
    ? {}
    : {
        title: PRICING.page.metaTitle,
        description: PRICING.page.metaDescription,
      };

/** Full pricing page. Brands without a free plan have no pricing story here — 404. */
export default async function PricingRoute({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (PRICING === null) notFound();
  return (
    <>
      <PricingPage locale={locale} />
      <CtaBand locale={locale} />
    </>
  );
}
