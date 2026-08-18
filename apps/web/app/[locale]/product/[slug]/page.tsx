import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { CtaBand } from '../../../../src/components/home/marketing-sections';
import { ModulePage } from '../../../../src/components/marketing/module-page';
import { getMarketingModule, marketingModules } from '../../../../src/content/modules';
import { activeBrand } from '../../../../src/lib/brand';

/**
 * One marketing page per module (`/product/[slug]`). Slugs come from the
 * marketing catalogue and are brand-filtered — a module the active brand
 * does not ship 404s rather than advertising something the deployment
 * cannot open (ADR 0010).
 */
export function generateStaticParams(): Array<{ slug: string }> {
  return marketingModules().map((module) => ({ slug: module.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const module = getMarketingModule(slug);
  if (module === undefined) return {};
  return {
    title: `${module.name} — ${activeBrand.name}`,
    description: module.tagline,
  };
}

export default async function ModuleMarketingPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const module = getMarketingModule(slug);
  if (module === undefined) notFound();
  return (
    <>
      <ModulePage module={module} locale={locale} />
      <CtaBand locale={locale} />
    </>
  );
}
