'use client';

import {
  AlertTriangle,
  Bell,
  Bot,
  Building2,
  ClipboardCheck,
  FileSignature,
  Flame,
  Siren,
  FlaskConical,
  FolderOpen,
  HardHat,
  ListChecks,
  Settings,
  ShieldAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { brandHasModule } from '@forma360/shared/brand';
import { activeBrand } from '../lib/brand';
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
    | 'incidents'
    | 'actions'
    | 'headsUp'
    | 'riskAssessments'
    | 'coshh'
    | 'permits'
    | 'fireSafety'
    | 'assets'
    | 'documents'
    | 'contractors'
    | 'settings';
  href: string;
  icon: LucideIcon;
}

/**
 * The shared nav-item list rendered by both the desktop sidebar and the
 * mobile drawer ({@link MobileNav} in mobile-nav.tsx). `onNavigate` lets
 * the mobile drawer close itself when a destination is picked.
 */
export function SiteNavItems({ locale, onNavigate }: { locale: string; onNavigate?: () => void }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const terminology = useTerminology();

  // Brand-gated (ADR 0010): Risk Assessments ships only where the active
  // brand's module catalogue enables it.
  const riskAssessmentsItem: NavItem = {
    key: 'riskAssessments',
    href: `/${locale}/risk-assessments`,
    icon: ShieldAlert,
  };
  // Brand-gated (ADR 0010): COSHH ships only where the active brand's
  // module catalogue enables it.
  const coshhItem: NavItem = {
    key: 'coshh',
    href: `/${locale}/coshh`,
    icon: FlaskConical,
  };
  // Brand-gated (ADR 0010): Permit to Work ships only where the active
  // brand's module catalogue enables it.
  const permitsItem: NavItem = {
    key: 'permits',
    href: `/${locale}/permits`,
    icon: FileSignature,
  };
  // Brand-gated (ADR 0010): Incidents ships only where the active
  // brand's module catalogue enables it. Sits between Observations and
  // Actions — the found → recorded → fixed reading order.
  const incidentsItem: NavItem = {
    key: 'incidents',
    href: `/${locale}/incidents`,
    icon: Siren,
  };
  // Brand-gated (ADR 0010): Fire Safety ships only where the active
  // brand's module catalogue enables it.
  const fireSafetyItem: NavItem = {
    key: 'fireSafety',
    href: `/${locale}/fire-safety`,
    icon: Flame,
  };

  const primary: NavItem[] = [
    { key: 'ai', href: `/${locale}/ai`, icon: Bot },
    { key: 'sites', href: `/${locale}/sites`, icon: Building2 },
    { key: 'inspections', href: `/${locale}/inspections`, icon: ClipboardCheck },
    { key: 'issues', href: `/${locale}/observations`, icon: AlertTriangle },
    ...(brandHasModule(activeBrand.id, 'incidents') ? [incidentsItem] : []),
    { key: 'actions', href: `/${locale}/actions`, icon: ListChecks },
    { key: 'headsUp', href: `/${locale}/heads-up`, icon: Bell },
    ...(brandHasModule(activeBrand.id, 'riskAssessments') ? [riskAssessmentsItem] : []),
    ...(brandHasModule(activeBrand.id, 'coshh') ? [coshhItem] : []),
    ...(brandHasModule(activeBrand.id, 'permits') ? [permitsItem] : []),
    ...(brandHasModule(activeBrand.id, 'fireSafety') ? [fireSafetyItem] : []),
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
        {...(onNavigate !== undefined ? { onClick: onNavigate } : {})}
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
    <nav aria-label={t('primaryLabel')} className="flex flex-1 flex-col gap-0.5 p-3">
      {primary.map(renderItem)}
      <div className="mt-auto pt-2">{renderItem(settingsItem)}</div>
    </nav>
  );
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
 *
 * Hidden below `md`; the header's {@link MobileNav} hamburger opens the
 * same items in a drawer there.
 */
export function SiteSidebar({ locale }: SiteSidebarProps) {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      {/* Brand wordmark at the top of the sidebar. */}
      <Link
        href={`/${locale}/ai`}
        className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4 font-semibold tracking-tight text-sidebar-foreground"
      >
        {activeBrand.name}
      </Link>
      <SiteNavItems locale={locale} />
    </aside>
  );
}
