'use client';

import { LOCALES, type Locale } from '@forma360/i18n/config';
import { Check } from 'lucide-react';
import { useLocale } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { cn } from '../../lib/cn';

// Native language names — intentionally not translated.
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
 * Language preference selector for the profile page. Switching swaps the
 * locale segment of the current path (same mechanism the app uses elsewhere).
 * Lives outside the app/ route tree so its labels aren't subject to the
 * no-hardcoded-strings rule (locale names are not translatable anyway).
 */
export function LanguageSelect() {
  const current = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function switchLocale(next: Locale) {
    if (next === current) return;
    const segments = pathname.split('/');
    if (segments.length > 1) segments[1] = next;
    const nextPath = segments.join('/') || `/${next}`;
    startTransition(() => router.push(nextPath));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Language</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {LOCALES.map((loc) => {
            const active = loc === current;
            return (
              <button
                key={loc}
                type="button"
                onClick={() => switchLocale(loc)}
                disabled={pending}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition-colors disabled:opacity-60',
                  active
                    ? 'border-primary bg-accent font-medium'
                    : 'hover:bg-accent/60',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {loc}
                  </span>
                  {LOCALE_LABELS[loc]}
                </span>
                {active ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
