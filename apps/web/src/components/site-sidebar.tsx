'use client';

import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { activeBrand } from '../lib/brand';
import { cn } from '../lib/cn';
import {
  activeNavItem,
  buildNavSections,
  isNavItemActive,
  settingsNavItem,
  type NavItem,
  type NavSection,
} from '../lib/nav-model';
import { useEntitlementList, usePermissionList } from '../lib/permissions-context';
import { navLabelKey, useTerminology } from '../lib/terminology';
import { useNavCounts, type NavCounts } from './nav/use-nav-counts';
import { LinkWhatsAppPrompt } from './whatsapp/link-whatsapp-prompt';

interface SiteSidebarProps {
  locale: string;
  /**
   * Tenant logo URL (ADR 0018), resolved server-side by the layout.
   * When set it replaces the brand wordmark in the header link.
   */
  logoUrl?: string | null;
}

/** localStorage key for the collapsed rail. */
const COLLAPSE_KEY = 'forma360.nav.collapsed';

/**
 * Read the persisted collapse state. Deliberately a lazy initialiser that
 * returns `false` on the server: the sidebar renders expanded during SSR
 * and settles on the stored value after hydration, which is a one-frame
 * width change rather than a hydration mismatch.
 */
function useCollapsed(): readonly [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // Private-mode storage refusal — stay expanded.
    }
  }, []);
  // ADR 0018: full-width surfaces (the dashboard) ask the rail to fold on
  // entry. One-way and not persisted as a preference: the user can
  // re-expand, and their stored choice is untouched.
  useEffect(() => {
    const onCollapse = (): void => setCollapsed(true);
    window.addEventListener('forma360:nav-collapse', onCollapse);
    return () => window.removeEventListener('forma360:nav-collapse', onCollapse);
  }, []);
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // Non-fatal: the preference just won't survive the session.
      }
      return next;
    });
  }, []);
  return [collapsed, toggle] as const;
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
          'relative flex items-center gap-2.5 rounded-md py-1.5 text-sm transition-colors',
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
      <div key={section.key ?? 'top'} className={section.key === null ? '' : 'mt-2 pt-2'}>
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
        {renderItem(settingsNavItem(locale), counts)}
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
export function SiteSidebar({ locale, logoUrl = null }: SiteSidebarProps) {
  const t = useTranslations('nav');
  const [collapsed, toggle] = useCollapsed();

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150 md:flex',
        collapsed ? 'w-12' : 'w-52',
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-sidebar-border px-1.5">
        {collapsed ? null : (
          <Link
            href={`/${locale}/my-work`}
            className="flex flex-1 items-center truncate px-1.5 text-[15px] font-semibold tracking-tight text-sidebar-foreground"
          >
            {/* ADR 0018: the tenant's own logo replaces the wordmark when set. */}
            {logoUrl !== null && logoUrl !== '' ? (
              <img
                src={logoUrl}
                alt={activeBrand.name}
                className="h-7 w-auto max-w-full object-contain"
              />
            ) : (
              activeBrand.name
            )}
          </Link>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('expandMenu') : t('collapseMenu')}
          title={collapsed ? t('expandMenu') : t('collapseMenu')}
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
            collapsed && 'mx-auto',
          )}
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
      <SiteNavItems locale={locale} collapsed={collapsed} />
    </aside>
  );
}
