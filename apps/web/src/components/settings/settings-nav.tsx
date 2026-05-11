'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/cn';

interface SettingsNavProps {
  locale: string;
  isAdmin: boolean;
}

interface AdminItem {
  key:
    | 'profile'
    | 'company'
    | 'users'
    | 'permissions'
    | 'groups'
    | 'sites'
    | 'customFields'
    | 'templates';
  href: string;
}

/**
 * Sidebar navigation for the settings shell. Highlights the currently
 * active route by prefix match (so deeply nested admin pages like
 * `/settings/groups/[id]` still light up "Groups").
 *
 * Admins see the full admin section + their profile entry; standard
 * users see only "Profile" because the layout already redirects them
 * out of admin-only routes server-side.
 */
export function SettingsNav({ locale, isAdmin }: SettingsNavProps) {
  const t = useTranslations('settings');
  const pathname = usePathname();

  const adminItems: AdminItem[] = [
    { key: 'profile', href: `/${locale}/settings/profile` },
    { key: 'company', href: `/${locale}/settings/company` },
    { key: 'users', href: `/${locale}/settings/users` },
    { key: 'permissions', href: `/${locale}/settings/permissions` },
    { key: 'groups', href: `/${locale}/settings/groups` },
    { key: 'sites', href: `/${locale}/settings/sites` },
    { key: 'customFields', href: `/${locale}/settings/custom-fields` },
  ];

  const placeholderSections = [
    { key: 'issues', phase: 3 },
    { key: 'actions', phase: 4 },
    { key: 'headsUp', phase: 5 },
    { key: 'assets', phase: 5 },
    { key: 'documents', phase: 5 },
    { key: 'compliance', phase: 8 },
    { key: 'training', phase: 10 },
    { key: 'integrations', phase: 10 },
    { key: 'billing', phase: 10 },
  ] as const;

  return (
    <aside className="w-56 shrink-0">
      <h2 className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('title')}
      </h2>
      <nav aria-label={t('title')} className="flex flex-col gap-1 text-sm">
        {isAdmin ? (
          <>
            {adminItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={cn(
                    'rounded-md px-3 py-2 transition-colors',
                    active
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  {t(`nav.${item.key}`)}
                </Link>
              );
            })}
            <div className="mt-6 border-t pt-4">
              {placeholderSections.map((s) => (
                <div
                  key={s.key}
                  className="px-3 py-1.5 text-xs text-muted-foreground"
                  aria-disabled
                >
                  {t(`nav.${s.key}`)} · {t('comingInPhase', { phase: s.phase })}
                </div>
              ))}
            </div>
          </>
        ) : (
          <Link
            href={`/${locale}/settings/profile`}
            className={cn(
              'rounded-md px-3 py-2 transition-colors',
              pathname === `/${locale}/settings/profile`
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            {t('nav.profile')}
          </Link>
        )}
      </nav>
    </aside>
  );
}
