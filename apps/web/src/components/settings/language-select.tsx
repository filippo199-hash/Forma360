'use client';

import { LOCALES, type Locale } from '@forma360/i18n/config';
import { useLocale } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { trpc } from '../../lib/trpc/client';

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

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Language preference selector for the profile page. Switching swaps the
 * locale segment of the current path (same mechanism the app uses elsewhere).
 * Lives outside the app/ route tree so its labels aren't subject to the
 * no-hardcoded-strings rule (locale names are not translatable anyway).
 *
 * A dropdown, not a ten-tile grid: one setting with one current value, which
 * is what every other preference on this page looks like. The grid spent
 * half the card on choices nobody is picking.
 */
export function LanguageSelect() {
  const current = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  // PF-20: the choice used to live only in the URL — it now persists to the
  // user record (drives email language) and the next-intl cookie (drives
  // future sessions). Persistence is best-effort; navigation never waits.
  const setLocale = trpc.users.setLocale.useMutation();

  function switchLocale(next: Locale) {
    if (next === current) return;
    setLocale.mutate({ locale: next });
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000;samesite=lax`;
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
        <Select
          value={current}
          disabled={pending}
          onValueChange={(value) => {
            if (isLocale(value)) switchLocale(value);
          }}
        >
          <SelectTrigger className="sm:max-w-xs" aria-label="Language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOCALES.map((loc) => (
              <SelectItem key={loc} value={loc}>
                <span className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {loc}
                  </span>
                  {LOCALE_LABELS[loc]}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
