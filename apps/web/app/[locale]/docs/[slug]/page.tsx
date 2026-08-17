import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { GuidePage } from '../../../../src/components/marketing/guide-page';
import { getGuide, guides } from '../../../../src/content/guides';
import { activeBrand } from '../../../../src/lib/brand';

/**
 * One guide per page (`/docs/[slug]`). Slugs come from the guide library
 * and are brand-filtered — a guide for a module the active brand does not
 * ship 404s (ADR 0010).
 */
export function generateStaticParams(): Array<{ slug: string }> {
  return guides().map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (guide === undefined) return {};
  return {
    title: `${guide.title} — ${activeBrand.name}`,
    description: guide.summary,
  };
}

export default async function GuideDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const guide = getGuide(slug);
  if (guide === undefined) notFound();
  return <GuidePage guide={guide} locale={locale} />;
}
