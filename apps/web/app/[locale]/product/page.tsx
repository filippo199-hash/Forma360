import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { CtaBand } from '../../../src/components/home/marketing-sections';
import { ProductIndex } from '../../../src/components/marketing/product-index';
import { MARKETING_PAGES } from '../../../src/content/site';

export const metadata: Metadata = {
  title: MARKETING_PAGES.product.metaTitle,
  description: MARKETING_PAGES.product.metaDescription,
};

export default async function ProductIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <>
      <ProductIndex locale={locale} />
      <CtaBand locale={locale} />
    </>
  );
}
