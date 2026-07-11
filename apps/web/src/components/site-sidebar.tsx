'use client';

import {
  AlertTriangle,
  Bell,
  Bot,
  Building2,
  ClipboardCheck,
  FolderOpen,
  HardHat,
  ListChecks,
  Settings,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../lib/cn';
import { navLabelKey, useTerminology } from '../lib/terminology';

interface SiteSidebarProps {
  locale: string;
}

interface NavItem {
  key:
    | 'ai'
    | 'sites'
    | 'inspections'
    | 'issues'
    | 'actions'
    | 'headsUp'
    | 'assets'
    | 'documents'
    | 'contractors'
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
  const terminology = useTerminology();

  const primary: NavItem[] = [
    { key: 'ai', href: `/${locale}/ai`, icon: Bot },
    { key: 'sites', href: `/${locale}/sites`, icon: Building2 },
    { key: 'inspections', href: `/${locale}/inspections`, icon: ClipboardCheck },
    { key: 'issues', href: `/${locale}/observations`, icon: AlertTriangle },
    { key: 'actions', href: `/${locale}/actions`, icon: ListChecks },
    { key: 'headsUp', href: `/${locale}/heads-up`, icon: Bell },
    { key: 'assets', href: `/${locale}/assets`, icon: Wrench },
    { key: 'documents', href: `/${locale}/documents`, icon: FolderOpen },
    { key: 'contractors', href: `/${locale}/contractors`, icon: HardHat },
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
        pathname.startsWith(`/${locale}/approvals`) || pathname.startsWith(`/${locale}/schedules`)
      );
    }
    return false;
  }

  function renderItem(item: NavItem) {
    const Icon = item.icon;
    const active = isActive(item);
    const label = item.key === 'sites' ? t(navLabelKey(terminology)) : t(item.key);
    return (
      <Link
        key={item.key}
        href={item.href}
        className={cn(
          'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
          active
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
        )}
        aria-current={active ? 'page' : undefined}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </Link>
    );
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      {/* Brand wordmark at the top of the sidebar. */}
      <Link
        href={`/${locale}/ai`}
        className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4 font-semibold tracking-tight text-sidebar-foreground"
      >
        Forma360
      </Link>
      <nav aria-label={t('primaryLabel')} className="flex flex-1 flex-col gap-0.5 p-3">
        {primary.map(renderItem)}
        <div className="mt-auto pt-2">{renderItem(settingsItem)}</div>
      </nav>
    </aside>
  );
}
