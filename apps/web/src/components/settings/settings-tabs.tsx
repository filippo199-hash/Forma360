'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/cn';

interface SettingsTabsProps {
  locale: string;
  isAdmin: boolean;
}

type TabKey = 'profile' | 'company' | 'users' | 'permissions' | 'groups' | 'sites';

/**
 * Horizontal tab bar for the settings sections. Replaces the old vertical
 * settings sidebar so the settings area keeps the normal platform chrome
 * (header + main sidebar) and only swaps content. Admins see every tab;
 * standard users see only "My profile".
 */
export function SettingsTabs({ locale, isAdmin }: SettingsTabsProps) {
  const t = useTranslations('settings');
  const pathname = usePathname();

  const allTabs: TabKey[] = ['profile', 'company', 'users', 'permissions', 'groups', 'sites'];
  const tabs: TabKey[] = isAdmin ? allTabs : ['profile'];

  return (
    <div className="border-b">
      <nav aria-label={t('title')} className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((key) => {
          const href = `/${locale}/settings/${key}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={key}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors',
                active
                  ? 'border-foreground font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
              )}
            >
              {t(`nav.${key}`)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
