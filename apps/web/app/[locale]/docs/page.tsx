import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { CtaBand } from '../../../src/components/home/marketing-sections';
import { DocsIndex } from '../../../src/components/marketing/docs-index';
import { MARKETING_PAGES } from '../../../src/content/site';

export const metadata: Metadata = {
  title: MARKETING_PAGES.docs.metaTitle,
  description: MARKETING_PAGES.docs.metaDescription,
};

export default async function DocsIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <>
      <DocsIndex locale={locale} />
      <CtaBand locale={locale} />
    </>
  );
}
