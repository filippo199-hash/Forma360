'use client';

import { LOCALES, type Locale } from '@forma360/i18n/config';
import {
  Check,
  Languages,
  LogOut,
  Moon,
  Settings,
  Sun,
  UserCircle,
  UserRound,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

// ─── Locale labels (native language names) ────────────────────────────────────
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

interface UserMenuProps {
  name: string;
  email: string;
  locale: string;
}

/**
 * Header user dropdown. Contains:
 * - User identity header (name + email)
 * - Profile + Settings links
 * - Language switcher (all 10 locales)
 * - Dark / light mode toggle
 * - Sign out
 */
export function UserMenu({ name, email, locale }: UserMenuProps) {
  const t = useTranslations('common');
  const currentLocale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [, startLocaleTransition] = useTransition();
  const [signingOut, setSigningOut] = useState(false);

  // Theme handling (next-themes needs mounted guard to avoid hydration flash)
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function switchLocale(next: Locale) {
    const segments = pathname.split('/');
    if (segments.length > 1) segments[1] = next;
    const nextPath = segments.join('/') || `/${next}`;
    startLocaleTransition(() => router.push(nextPath));
  }

  async function onSignOut() {
    setSigningOut(true);
    try {
      await fetch('/api/auth/sign-out', { method: 'POST' });
    } catch {
      // Even if sign-out fails, reload to hit the auth layer
    }
    window.location.assign(`/${locale}`);
  }

  const display = name.length > 0 ? name : email;
  const isDark = resolvedTheme === 'dark';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="flex items-center gap-2" aria-label={display}>
          <UserRound className="h-4 w-4" aria-hidden />
          <span className="hidden max-w-[14ch] truncate sm:inline">{display}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        {/* ── Identity ─────────────────────────────────────────────────────── */}
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{display}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </div>
        <DropdownMenuSeparator />

        {/* ── Navigation ───────────────────────────────────────────────────── */}
        <DropdownMenuItem asChild>
          <Link href={`/${locale}/settings/profile`} className="flex items-center gap-2">
            <UserCircle className="h-4 w-4" aria-hidden />
            {t('profileLink')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/${locale}/settings`} className="flex items-center gap-2">
            <Settings className="h-4 w-4" aria-hidden />
            {t('settingsLink')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        {/* ── Language ─────────────────────────────────────────────────────── */}
        <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Languages className="h-3.5 w-3.5" aria-hidden />
          {t('locale.switch')}
        </DropdownMenuLabel>
        {LOCALES.map((loc) => (
          <DropdownMenuItem
            key={loc}
            onSelect={() => switchLocale(loc)}
            className="flex items-center gap-2"
          >
            <span className="w-4 shrink-0 text-center text-[10px] uppercase tracking-wide text-muted-foreground">
              {loc}
            </span>
            <span className="flex-1">{LOCALE_LABELS[loc]}</span>
            {loc === currentLocale ? (
              <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />

        {/* ── Theme ────────────────────────────────────────────────────────── */}
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            if (mounted) setTheme(isDark ? 'light' : 'dark');
          }}
          className="flex items-center gap-2"
        >
          {mounted && isDark ? (
            <Sun className="h-4 w-4" aria-hidden />
          ) : (
            <Moon className="h-4 w-4" aria-hidden />
          )}
          {mounted
            ? isDark
              ? t('theme.switchLight')
              : t('theme.switchDark')
            : t('theme.toggle')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        {/* ── Sign out ─────────────────────────────────────────────────────── */}
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            if (!signingOut) void onSignOut();
          }}
          className="flex items-center gap-2"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
