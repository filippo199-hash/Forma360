import { setRequestLocale } from 'next-intl/server';
import { getTranslations } from 'next-intl/server';

/**
 * Locale-scoped landing page. Renders translated auth CTAs via next-intl
 * so the i18n lint rule has something real to validate against.
 *
 * Actual sign-in / sign-up forms land in PR 9 with shadcn/ui.
 */
export default async function LocaleHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  return (
    <main
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div>
        <h1>{t('auth.signIn.title')}</h1>
        <p>{t('common.loading')}</p>
      </div>
    </main>
  );
}
