import { setRequestLocale } from 'next-intl/server';
import { AiChat } from '../../../src/components/ai/ai-chat';

export default async function AiPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <AiChat />;
}
