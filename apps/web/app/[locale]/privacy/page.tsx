import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LegalPage } from '../../../src/components/legal/legal-page';
import { PRIVACY_POLICY } from '../../../src/content/legal';
import { activeBrand } from '../../../src/lib/brand';

export const metadata: Metadata = {
  title: `Privacy Policy — ${activeBrand.name}`,
  description: `How ${activeBrand.name} collects, uses and protects your personal data.`,
};

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalPage doc={PRIVACY_POLICY} />;
}
