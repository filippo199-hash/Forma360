import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LegalPage } from '../../../src/components/legal/legal-page';
import { DATA_DELETION } from '../../../src/content/legal';
import { activeBrand } from '../../../src/lib/brand';

export const metadata: Metadata = {
  title: `Data Deletion — ${activeBrand.name}`,
  description: 'How to request deletion of your personal data, including WhatsApp data.',
};

export default async function DataDeletionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalPage doc={DATA_DELETION} />;
}
