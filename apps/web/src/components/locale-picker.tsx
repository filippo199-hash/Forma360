'use client';

import { LOCALES, type Locale } from '@forma360/i18n/config';
import { Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  it: 'Italiano',
  nl: 'Nederlands',
  pl: 'Polski',
  ja: '日本語',
  zh: '中文',
};

/**
 * Quick language picker. Stub in Phase 0 — switches the URL prefix but does
 * not persist a per-user preference yet. Phase 1 adds the per-user setting
 * in Settings → Personal and writes it to the session cookie.
 */
export function LocalePicker() {
  const current = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const t = useTranslations('common');

  function switchTo(locale: Locale) {
    const segments = pathname.split('/');
    // /<locale>/... -> replace first segment; the middleware normalises.
    if (segments.length > 1) {
      segments[1] = locale;
    }
    const next = segments.join('/') || `/${locale}`;
    startTransition(() => router.push(next));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('locale.switch')}>
          <Languages className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onSelect={() => switchTo(locale)}
            data-active={locale === current}
          >
            <span className="mr-2 text-xs uppercase tracking-wide text-muted-foreground">
              {locale}
            </span>
            {LOCALE_LABELS[locale]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
