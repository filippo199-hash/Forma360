'use client';

/**
 * Bottom tab bar (ADR 0014) — phones only.
 *
 * Before this, the only way to change module on a phone was the hamburger
 * in the header: reach to the top-left of the screen, open a drawer,
 * scroll a nineteen-item list, tap. That is three interactions and a
 * long reach for something a field user does dozens of times a shift,
 * and the header is the least reachable part of a phone screen held one-
 * handed. The tab bar puts the destinations that matter inside the thumb
 * arc and leaves the drawer for everything else.
 *
 * Which tabs appear is decided by {@link buildMobileTabs} from the same
 * permission-gated model the sidebar renders, so a viewer never gets a
 * tab they cannot open.
 */
import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeBrand } from '../lib/brand';
import { cn } from '../lib/cn';
import { buildMobileTabs, buildNavSections, isNavItemActive } from '../lib/nav-model';
import { usePermissionList } from '../lib/permissions-context';
import { navLabelKey, useTerminology } from '../lib/terminology';
import { NavDrawer } from './mobile-nav';
import { useNavCounts } from './nav/use-nav-counts';

export function MobileTabBar({ locale }: { locale: string }) {
  const t = useTranslations('nav');
  const perms = usePermissionList();
  const pathname = usePathname();
  const terminology = useTerminology();
  const counts = useNavCounts();

  const sections = buildNavSections({ locale, brandId: activeBrand.id, permissions: perms });
  const tabs = buildMobileTabs(sections);

  return (
    <nav
      aria-label={t('quickLabel')}
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden"
    >
      {tabs.map((item) => {
        const Icon = item.icon;
        const active = isNavItemActive(item, pathname);
        const label = item.key === 'sites' ? t(navLabelKey(terminology)) : t(item.key);
        const badge = item.badge === undefined ? 0 : (counts[item.badge] ?? 0);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[11px] transition-colors',
              active ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            <span className="relative">
              <Icon className="h-5 w-5" aria-hidden="true" />
              {badge > 0 ? (
                <span className="absolute -right-2 -top-1 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
                  {badge > 9 ? '9+' : badge}
                </span>
              ) : null}
            </span>
            <span className="w-full truncate text-center">{label}</span>
          </Link>
        );
      })}
      <NavDrawer
        locale={locale}
        trigger={
          <button
            type="button"
            className="flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[11px] text-muted-foreground transition-colors"
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            <span className="w-full truncate text-center">{t('more')}</span>
          </button>
        }
      />
    </nav>
  );
}
