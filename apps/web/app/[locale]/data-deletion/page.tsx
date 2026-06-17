import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LegalPage } from '../../../src/components/legal/legal-page';
import { DATA_DELETION } from '../../../src/content/legal';

export const metadata: Metadata = {
  title: 'Data Deletion — Forma360',
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
