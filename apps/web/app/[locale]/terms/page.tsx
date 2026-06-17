import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LegalPage } from '../../../src/components/legal/legal-page';
import { TERMS_OF_SERVICE } from '../../../src/content/legal';

export const metadata: Metadata = {
  title: 'Terms of Service — Forma360',
  description: 'The terms that govern your use of the Forma360 platform and AI assistant.',
};

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalPage doc={TERMS_OF_SERVICE} />;
}
