'use client';

import {
  AlertTriangle,
  Bell,
  Bot,
  ClipboardCheck,
  FolderOpen,
  ListChecks,
  Settings,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../lib/cn';

interface SiteSidebarProps {
  locale: string;
}

interface NavItem {
  key:
    | 'ai'
    | 'inspections'
    | 'issues'
    | 'actions'
    | 'headsUp'
    | 'assets'
    | 'documents'
    | 'settings';
  href: string;
  icon: LucideIcon;
}

/**
 * Global left navigation. Module-level entries surface here; the
 * settings page keeps its own nested nav under the Settings entry.
 * Active-route detection matches the settings-nav pattern — exact match
 * or prefix-match with a trailing slash so deep nested routes still
 * light up the right parent.
 *
 * Render only when the viewer is signed in (the LocaleLayout decides
 * that). Template-editor pages use `fixed inset-0 z-50` so they overlay
 * the sidebar without disturbing layout flow.
 */
export function SiteSidebar({ locale }: SiteSidebarProps) {
  const t = useTranslations('nav');
  const pathname = usePathname();

  const primary: NavItem[] = [
    { key: 'ai', href: `/${locale}/ai`, icon: Bot },
    { key: 'inspections', href: `/${locale}/inspections`, icon: ClipboardCheck },
    { key: 'issues', href: `/${locale}/observations`, icon: AlertTriangle },
    { key: 'actions', href: `/${locale}/actions`, icon: ListChecks },
    { key: 'headsUp', href: `/${locale}/heads-up`, icon: Bell },
    { key: 'assets', href: `/${locale}/assets`, icon: Wrench },
    { key: 'documents', href: `/${locale}/documents`, icon: FolderOpen },
  ];

  const settingsItem: NavItem = {
    key: 'settings',
    href: `/${locale}/settings`,
    icon: Settings,
  };

  function isActive(item: NavItem): boolean {
    const { href } = item;
    if (pathname === href || pathname.startsWith(`${href}/`)) return true;
    if (item.key === 'inspections') {
      return (
        pathname.startsWith(`/${locale}/approvals`) ||
        pathname.startsWith(`/${locale}/schedules`)
      );
    }
    return false;
  }

  function renderItem(item: NavItem) {
    const Icon = item.icon;
    const active = isActive(item);
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
        <span>{t(item.key)}</span>
      </Link>
    );
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r bg-card md:flex md:flex-col">
      <nav aria-label={t('primaryLabel')} className="flex h-full flex-col gap-1 p-3">
        {primary.map(renderItem)}
        <div className="mt-auto border-t pt-3">{renderItem(settingsItem)}</div>
      </nav>
    </aside>
  );
}
