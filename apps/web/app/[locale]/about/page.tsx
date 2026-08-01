import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { ABOUT } from '../../../src/content/legal';
import { activeBrand } from '../../../src/lib/brand';

export const metadata: Metadata = {
  title: `About — ${activeBrand.name}`,
  description: `What ${activeBrand.name} is and how its AI assistant works.`,
};

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <article className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{ABOUT.title}</h1>
      <div className="mt-6 space-y-4">
        {ABOUT.paragraphs.map((p, i) => (
          <p key={`about-${i}`} className="leading-relaxed text-muted-foreground">
            {p}
          </p>
        ))}
      </div>
    </article>
  );
}
