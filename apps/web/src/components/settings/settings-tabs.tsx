'use client';

import { brandHasModule } from '@forma360/shared/brand';
import { useTranslations } from 'next-intl';
import { useHasPermission } from '../../lib/permissions-context';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeBrand } from '../../lib/brand';
import { cn } from '../../lib/cn';

interface SettingsTabsProps {
  locale: string;
  isAdmin: boolean;
}

type TabKey =
  | 'profile'
  | 'company'
  | 'users'
  | 'permissions'
  | 'groups'
  | 'customFields'
  | 'riskMatrix'
  | 'audit';

/**
 * Folder segment for each tab. Most tabs live at a folder named after the key;
 * `customFields` lives at the kebab-case `custom-fields` folder.
 */
const TAB_HREF: Record<TabKey, string> = {
  profile: 'profile',
  company: 'company',
  users: 'users',
  permissions: 'permissions',
  groups: 'groups',
  customFields: 'custom-fields',
  riskMatrix: 'risk-matrix',
  audit: 'audit',
};

/**
 * Horizontal tab bar for the settings sections. Replaces the old vertical
 * settings sidebar so the settings area keeps the normal platform chrome
 * (header + main sidebar) and only swaps content. Admins see every tab;
 * standard users see only "My profile".
 */
export function SettingsTabs({ locale, isAdmin }: SettingsTabsProps) {
  const t = useTranslations('settings');
  const pathname = usePathname();
  const canInviteUsers = useHasPermission('users.invite');
  const canManageUsers = useHasPermission('users.manage');
  const canManagePermissions = useHasPermission('permissions.manage');
  const canManageGroups = useHasPermission('groups.manage');
  const canManageCustomFields = useHasPermission('users.customFields.manage');
  const canViewAudit = useHasPermission('org.audit.view');

  // PF-7 (platform review): the tab bar used to gate EVERYTHING on the
  // admin-only org.settings key, so a seeded Manager — the role designed
  // to invite the team — saw only "My profile" and had to type the URL.
  // Each tab now shows for the permission that its page actually needs;
  // admin keeps the full set.
  const tabs: TabKey[] = [
    'profile',
    ...(isAdmin ? (['company'] as TabKey[]) : []),
    ...(isAdmin || canInviteUsers || canManageUsers ? (['users'] as TabKey[]) : []),
    ...(isAdmin || canManagePermissions ? (['permissions'] as TabKey[]) : []),
    ...(isAdmin || canManageGroups ? (['groups'] as TabKey[]) : []),
    ...(isAdmin || canManageCustomFields ? (['customFields'] as TabKey[]) : []),
    ...(isAdmin && brandHasModule(activeBrand.id, 'riskAssessments')
      ? (['riskMatrix'] as TabKey[])
      : []),
    // PF-31: the tenant-wide audit feed.
    ...(isAdmin || canViewAudit ? (['audit'] as TabKey[]) : []),
  ];

  return (
    <div className="border-b">
      <nav aria-label={t('title')} className="flex gap-1 overflow-x-auto">
        {tabs.map((key) => {
          const href = `/${locale}/settings/${TAB_HREF[key]}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={key}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'whitespace-nowrap -mb-px border-b-2 px-3 py-2.5 text-sm transition-colors',
                active
                  ? 'border-foreground font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
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
