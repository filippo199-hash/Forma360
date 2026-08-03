/**
 * Offline fallback (PF-10) — the page the service worker serves when a
 * navigation fails without connectivity. Locale negotiated from the
 * request headers (same approach as /scan): the SW caches whatever
 * language the device installed with.
 */
import { DEFAULT_LOCALE, isLocale } from '@forma360/i18n/config';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { activeBrand } from '../../src/lib/brand';

function negotiateLocale(acceptLanguage: string | null): string {
  if (acceptLanguage === null) return DEFAULT_LOCALE;
  for (const part of acceptLanguage.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? '';
    const primary = tag.split('-')[0] ?? '';
    if (isLocale(tag)) return tag;
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

export default async function OfflinePage() {
  const locale = negotiateLocale((await headers()).get('accept-language'));
  const t = await getTranslations({ locale, namespace: 'offline' });
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="text-xl font-semibold tracking-tight">{activeBrand.name}</span>
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('body')}</p>
    </main>
  );
}

export const dynamic = 'force-dynamic';
