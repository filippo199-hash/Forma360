'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Minimal top bar for the external contractor portal — brand + sign-out only.
 * Deliberately excludes the internal global search and settings menu.
 */
export function PortalHeader({ name, locale }: { name: string; locale: string }) {
  const t = useTranslations('contractors');

  async function signOut() {
    try {
      await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch {
      // fall through to reload regardless
    }
    window.location.assign(`/${locale}`);
  }

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-2.5">
        <span className="font-semibold tracking-tight">Forma360</span>
        <div className="flex items-center gap-3">
          {name.length > 0 ? (
            <span className="hidden text-sm text-muted-foreground sm:inline">{name}</span>
          ) : null}
          <button
            type="button"
            onClick={signOut}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            {t('portal.signOut')}
          </button>
        </div>
      </div>
    </header>
  );
}
