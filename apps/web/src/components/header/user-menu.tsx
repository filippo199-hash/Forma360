'use client';

import { LogOut, Settings, UserCircle, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
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
 * Header user dropdown. Trigger shows a person icon + (on wider
 * viewports) the user's name. Menu has Profile, Settings, and Sign
 * out. Sign-out POSTs to better-auth's endpoint then reloads.
 */
export function UserMenu({ name, email, locale }: UserMenuProps) {
  const t = useTranslations('common');
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    setSigningOut(true);
    try {
      await fetch('/api/auth/sign-out', { method: 'POST' });
    } catch {
      // Even if sign-out fails (network drop), reloading hits the
      // tRPC layer which will surface UNAUTHENTICATED and let the
      // user see the sign-in card.
    }
    window.location.assign(`/${locale}`);
  }

  const display = name.length > 0 ? name : email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-2"
          aria-label={display}
        >
          <UserRound className="h-4 w-4" aria-hidden />
          <span className="hidden max-w-[14ch] truncate sm:inline">{display}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{display}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </div>
        <DropdownMenuSeparator />
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
