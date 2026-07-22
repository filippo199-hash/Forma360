'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { SiteNavItems } from './site-sidebar';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from './ui/sheet';

/**
 * Mobile navigation drawer. Below `md` the desktop sidebar is hidden, so
 * this hamburger in the header is the only way to move between modules on
 * a phone. Opens a left-side sheet with the same nav items as the sidebar
 * ({@link SiteNavItems}); picking a destination closes the drawer.
 */
export function MobileNav({ locale }: { locale: string }) {
  const t = useTranslations('nav');
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent md:hidden"
        aria-label={t('primaryLabel')}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="flex w-72 max-w-[85vw] flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
      >
        <SheetTitle className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-4 text-base font-semibold tracking-tight text-sidebar-foreground">
          Forma360
        </SheetTitle>
        <SiteNavItems locale={locale} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
