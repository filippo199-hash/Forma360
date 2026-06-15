'use client';

import {
  Building2,
  ListChecks,
  MapPin,
  Shield,
  SlidersHorizontal,
  User,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/cn';

interface SettingsNavProps {
  locale: string;
  isAdmin: boolean;
}

interface NavItem {
  key:
    | 'profile'
    | 'company'
    | 'users'
    | 'permissions'
    | 'groups'
    | 'sites'
    | 'customFields'
    | 'actions';
  href: string;
  icon: LucideIcon;
}

/**
 * Sidebar navigation for the settings shell. Matches the visual style of
 * `SiteSidebar` (icon + label, same active/inactive classes, same spacing).
 *
 * Admins see the full set; standard users see only "My profile".
 */
export function SettingsNav({ locale, isAdmin }: SettingsNavProps) {
  const t = useTranslations('settings');
  const pathname = usePathname();

  const adminItems: NavItem[] = [
    { key: 'profile', href: `/${locale}/settings/profile`, icon: User },
    { key: 'company', href: `/${locale}/settings/company`, icon: Building2 },
    { key: 'users', href: `/${locale}/settings/users`, icon: UserCog },
    { key: 'permissions', href: `/${locale}/settings/permissions`, icon: Shield },
    { key: 'groups', href: `/${locale}/settings/groups`, icon: Users },
    { key: 'sites', href: `/${locale}/settings/sites`, icon: MapPin },
    { key: 'customFields', href: `/${locale}/settings/custom-fields`, icon: SlidersHorizontal },
    { key: 'actions', href: `/${locale}/settings/actions`, icon: ListChecks },
  ];

  const profileItem: NavItem = {
    key: 'profile',
    href: `/${locale}/settings/profile`,
    icon: User,
  };

  function renderItem(item: NavItem) {
    const Icon = item.icon;
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link
        key={item.key}
        href={item.href}
        className={cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          active
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        )}
        aria-current={active ? 'page' : undefined}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t(`nav.${item.key}`)}</span>
      </Link>
    );
  }

  return (
    <aside className="w-56 shrink-0">
      <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('title')}
      </p>
      <nav aria-label={t('title')} className="flex flex-col gap-0.5">
        {isAdmin ? adminItems.map(renderItem) : renderItem(profileItem)}
      </nav>
    </aside>
  );
}
