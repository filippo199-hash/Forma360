'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeBrand } from '../lib/brand';
import { cn } from '../lib/cn';
import {
  activeNavItem,
  buildNavSections,
  isNavItemActive,
  type NavItem,
  type NavSection,
} from '../lib/nav-model';
import { useEntitlementList, usePermissionList } from '../lib/permissions-context';
import { navLabelKey, useTerminology } from '../lib/terminology';
import { GlobalSearch } from './global-search';
import { useNavCounts, type NavCounts } from './nav/use-nav-counts';
import { LinkWhatsAppPrompt } from './whatsapp/link-whatsapp-prompt';

interface SiteSidebarProps {
  locale: string;
}

function NavBadge({ value, collapsed }: { value: number; collapsed: boolean }) {
  if (value <= 0) return null;
  const label = value > 99 ? '99+' : String(value);
  if (collapsed) {
    // On the rail there is no room for a number; a dot still says
    // "something is waiting here" without lying about how much.
    return (
      <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
    );
  }
  return (
    // Neutral rather than blue: the selected row is itself a blue wash now,
    // and a blue-on-blue chip disappears exactly when it is being looked at.
    <span className="ml-auto min-w-5 rounded-full bg-sidebar-foreground/10 px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-sidebar-foreground">
      {label}
    </span>
  );
}

/**
 * The shared nav-item list rendered by the desktop sidebar and the mobile
 * drawer ({@link MobileNav} in mobile-nav.tsx). `onNavigate` lets the
 * drawer close itself when a destination is picked; `collapsed` renders
 * the icon-only rail.
 */
export function SiteNavItems({
  locale,
  onNavigate,
  collapsed = false,
}: {
  locale: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const t = useTranslations('nav');
  const perms = usePermissionList();
  const entitlements = useEntitlementList();
  const pathname = usePathname();
  const terminology = useTerminology();
  const counts = useNavCounts();

  const sections = buildNavSections({
    locale,
    brandId: activeBrand.id,
    permissions: perms,
    entitlements,
  });
  // Which module the current route belongs to — used to light up the right
  // row even on a sub-page whose path lives outside the module's own prefix
  // (Approvals/Schedules/Templates under Inspections). The sub-pages are
  // tabs on the page now, not menu children.
  const active = activeNavItem(sections, pathname);

  function labelFor(item: NavItem): string {
    // The tenant chooses whether its places are "Sites", "Projects" or both.
    return item.key === 'sites' ? t(navLabelKey(terminology)) : t(item.key);
  }

  function renderItem(item: NavItem, navCounts: NavCounts) {
    const Icon = item.icon;
    const isActive = isNavItemActive(item, pathname) || active?.key === item.key;
    const label = labelFor(item);
    const badge = item.badge === undefined ? 0 : (navCounts[item.badge] ?? 0);
    return (
      <Link
        key={item.key}
        href={item.href}
        {...(onNavigate !== undefined ? { onClick: onNavigate } : {})}
        className={cn(
          'relative flex items-center gap-2.5 rounded-md py-[7px] text-sm transition-colors',
          collapsed ? 'justify-center px-2' : 'px-2.5',
          isActive
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : // Full-strength foreground, not a dimmed tint: on a white rail
              // the greyed-out label was the thing that read as unfinished,
              // and the icon inherits currentColor so it darkens with it.
              'text-sidebar-foreground hover:bg-sidebar-accent/60',
        )}
        aria-current={isActive ? 'page' : undefined}
        {...(collapsed ? { title: label, 'aria-label': label } : {})}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {collapsed ? null : <span className="truncate">{label}</span>}
        <NavBadge value={badge} collapsed={collapsed} />
      </Link>
    );
  }

  /**
   * A group is a hairline rule, not a heading. The headings ("Do the
   * work", "Records & registers", "The organisation") named a grouping
   * the icons and reading order already convey, and each one cost a row
   * of vertical space plus a fold control on a menu whose whole job is
   * to get out of the way. The rule keeps the seam; the words go.
   *
   * Sub-navigation does not live here either (ADR 0014 amendment): a
   * module's sub-pages are tabs on the page (see ModuleTabs), so the
   * sidebar is exactly the module list, expanded or collapsed.
   */
  function renderSection(section: NavSection) {
    return (
      <div key={section.key ?? 'top'} className={section.key === null ? '' : 'pt-2'}>
        {section.key === null ? null : (
          <div
            className={cn('mb-2 border-t border-sidebar-border', collapsed ? 'mx-1.5' : 'mx-2.5')}
            role="presentation"
          />
        )}
        <ul className="flex list-none flex-col gap-0.5 p-0">
          {section.items.map((item) => (
            <li key={item.key}>{renderItem(item, counts)}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <nav
      aria-label={t('primaryLabel')}
      className={cn('flex flex-1 flex-col overflow-y-auto p-2', collapsed && 'px-1.5')}
    >
      {sections.map(renderSection)}
      <div className="mt-auto pt-2">
        <LinkWhatsAppPrompt collapsed={collapsed} />
      </div>
    </nav>
  );
}

/**
 * Global left navigation (ADR 0014). Entries are grouped by the shape of
 * the work — control the risk, verify it, respond to what you found, and
 * the organisational records underneath — rather than presented as one
 * flat alphabet of modules. Brand and permission gating happen in the
 * model (`lib/nav-model.ts`), which is unit-tested; this component is
 * purely presentational.
 *
 * Render only when the viewer is signed in (the LocaleLayout decides
 * that). Template-editor pages use `fixed inset-0 z-50` so they overlay
 * the sidebar without disturbing layout flow.
 *
 * Hidden below `md`; on a phone the header's {@link MobileNav} hamburger
 * opens the same items in a drawer and the {@link MobileTabBar} pins the
 * few destinations that matter with a thumb.
 */
export function SiteSidebar({ locale }: SiteSidebarProps) {
  return (
    <aside
      // Sticks below the top bar rather than starting one of its own:
      // the bar is a single strip across the whole app now. 57px = the
      // bar's h-14 plus its bottom hairline; 56 would let the first row
      // peek through. Fixed width: the fold control is gone from the
      // header by design, so the rail no longer collapses.
      className="sticky top-[57px] hidden h-[calc(100vh-57px)] w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex"
    >
      {/* Search lives at the top of the rail (its modal portals to <body>,
          so mounting inside the sidebar is safe). ⌘K works from anywhere. */}
      <div className="px-2 pt-2">
        <GlobalSearch variant="sidebar" />
      </div>
      <SiteNavItems locale={locale} />
    </aside>
  );
}
