'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { NAV, PRICING } from '../content/site';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

/**
 * Marketing navigation for signed-out visitors on small screens. The
 * desktop header shows Modules / Docs / Pricing inline from `md:` up;
 * below that these destinations previously existed only in the footer —
 * a full homepage-scroll away on the devices most site workers hold.
 */
export function MarketingMobileNav({ locale }: { locale: string }) {
  const links: Array<{ href: string; label: string }> = [
    { href: `/${locale}/product`, label: NAV.modules },
    { href: `/${locale}/docs`, label: NAV.docs },
    ...(PRICING !== null ? [{ href: `/${locale}/pricing`, label: NAV.pricing }] : []),
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={NAV.modules}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground md:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {links.map((link) => (
          <DropdownMenuItem key={link.href} asChild>
            <Link href={link.href} className="w-full cursor-pointer">
              {link.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
