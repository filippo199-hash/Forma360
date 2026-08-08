'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { activeBrand } from '../lib/brand';
import { SiteNavItems } from './site-sidebar';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from './ui/sheet';

/**
 * The full menu in a left-hand drawer, opened by whatever `trigger` is
 * passed in. Below `md` the desktop sidebar is hidden, so this drawer is
 * where the complete grouped nav lives; the {@link MobileTabBar} pins
 * only the handful of destinations worth a permanent slot.
 *
 * Two triggers use it — the header hamburger and the tab bar's "More" —
 * and each owns its own instance, so neither has to lift open-state into
 * the layout.
 */
export function NavDrawer({ locale, trigger }: { locale: string; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side="left"
        className="flex w-64 max-w-[85vw] flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
      >
        <SheetTitle className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-3.5 text-[15px] font-semibold tracking-tight text-sidebar-foreground">
          {activeBrand.name}
        </SheetTitle>
        <SiteNavItems locale={locale} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

/** The header hamburger. */
export function MobileNav({ locale }: { locale: string }) {
  const t = useTranslations('nav');

  return (
    <NavDrawer
      locale={locale}
      trigger={
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent md:hidden"
          aria-label={t('primaryLabel')}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      }
    />
  );
}
