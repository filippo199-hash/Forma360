import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { SecurityPage } from '../../../src/components/marketing/security-page';
import { SECURITY } from '../../../src/content/security';

export const metadata: Metadata = {
  title: SECURITY.metaTitle,
  description: SECURITY.metaDescription,
};

export default async function SecurityRoute({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SecurityPage />;
}
