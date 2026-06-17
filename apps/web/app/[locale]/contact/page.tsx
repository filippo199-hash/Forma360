import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { CONTACT } from '../../../src/content/legal';

export const metadata: Metadata = {
  title: 'Contact — Forma360',
  description: 'Get in touch with the Forma360 team.',
};

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <article className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{CONTACT.title}</h1>
      <p className="mt-3 leading-relaxed text-muted-foreground">{CONTACT.intro}</p>
      <dl className="mt-8 space-y-5">
        {CONTACT.items.map((item) => (
          <div key={item.label} className="border-b pb-4">
            <dt className="text-sm font-medium">{item.label}</dt>
            <dd className="mt-0.5 text-muted-foreground">{item.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
