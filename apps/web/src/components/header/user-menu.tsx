'use client';

import { LogOut, Moon, Settings, Sun, UserCircle, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

interface UserMenuProps {
  name: string;
  email: string;
  locale: string;
}

/**
 * Header user dropdown. Contains:
 * - User identity header (name + email)
 * - Profile + Settings links
 * - Dark / light mode toggle
 * - Sign out
 *
 * Language is chosen on the profile page, not here.
 */
export function UserMenu({ name, email, locale }: UserMenuProps) {
  const t = useTranslations('common');
  const [signingOut, setSigningOut] = useState(false);

  // Theme handling (next-themes needs mounted guard to avoid hydration flash)
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  async function onSignOut() {
    setSigningOut(true);
    try {
      // better-auth's sign-out handler parses the request body as JSON, so an
      // empty body throws "Unexpected end of JSON input" (HTTP 500). Always
      // send a valid JSON body so the session is actually cleared.
      await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
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
        {/* Icon-only: the identity (name + email) lives in the dropdown
            header, and the email is already the top-left workspace trigger. */}
        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={display}>
          <UserRound className="h-4 w-4" aria-hidden />
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
          {mounted ? (isDark ? t('theme.switchLight') : t('theme.switchDark')) : t('theme.toggle')}
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
