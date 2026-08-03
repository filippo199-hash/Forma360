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
  isNavChildActive,
  isNavItemActive,
  NAV_CHILD_ICON,
  settingsNavItem,
  type NavChild,
  type NavItem,
  type NavSection,
} from '../lib/nav-model';
import { usePermissionList } from '../lib/permissions-context';
import { navLabelKey, useTerminology } from '../lib/terminology';
import { useNavCounts, type NavCounts } from './nav/use-nav-counts';

interface SiteSidebarProps {
  locale: string;
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
      <span
        className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand"
        aria-hidden="true"
      />
    );
  }
  return (
    <span className="ml-auto min-w-5 rounded-full bg-brand px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-brand-foreground">
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
  const pathname = usePathname();
  const terminology = useTerminology();
  const counts = useNavCounts();

  const sections = buildNavSections({
    locale,
    brandId: activeBrand.id,
    permissions: perms,
  });
  const active = activeNavItem(sections, pathname);

  function labelFor(item: NavItem): string {
    // The tenant chooses whether its places are "Sites", "Projects" or both.
    return item.key === 'sites' ? t(navLabelKey(terminology)) : t(item.key);
  }

  function renderChild(child: NavChild) {
    const Icon = NAV_CHILD_ICON[child.key];
    const isActive = isNavChildActive(child, pathname);
    return (
      <Link
        key={child.key}
        href={child.href}
        {...(onNavigate !== undefined ? { onClick: onNavigate } : {})}
        className={cn(
          'ml-4 flex items-center gap-2 rounded-md border-l border-sidebar-border py-1.5 pl-4 pr-3 text-[13px] transition-colors',
          isActive
            ? 'font-medium text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/65 hover:text-sidebar-foreground',
        )}
        aria-current={isActive ? 'page' : undefined}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{t(`child.${child.key}`)}</span>
      </Link>
    );
  }

  function renderItem(item: NavItem, navCounts: NavCounts) {
    const Icon = item.icon;
    const isActive = isNavItemActive(item, pathname);
    const label = labelFor(item);
    const badge = item.badge === undefined ? 0 : (navCounts[item.badge] ?? 0);
    return (
      <Link
        key={item.key}
        href={item.href}
        {...(onNavigate !== undefined ? { onClick: onNavigate } : {})}
        className={cn(
          'relative flex items-center gap-2.5 rounded-md py-2 text-sm transition-colors',
          collapsed ? 'justify-center px-2' : 'px-3',
          isActive
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
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

  function renderSection(section: NavSection) {
    return (
      <div key={section.key ?? 'top'} className={cn(section.key === null ? '' : 'mt-4')}>
        {section.key !== null ? (
          collapsed ? (
            <div className="mx-2 mb-2 border-t border-sidebar-border" role="presentation" />
          ) : (
            <h2 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
              {t(section.key)}
            </h2>
          )
        ) : null}
        <div className="flex flex-col gap-0.5">
          {section.items.map((item) => (
            <div key={item.key} className="flex flex-col gap-0.5">
              {renderItem(item, counts)}
              {/* Sub-navigation appears only under the entry that owns the
               * current route, so the resting menu stays module-length. */}
              {!collapsed && active?.key === item.key
                ? (item.children ?? []).map(renderChild)
                : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <nav
      aria-label={t('primaryLabel')}
      className={cn('flex flex-1 flex-col overflow-y-auto p-3', collapsed && 'px-2')}
    >
      {sections.map(renderSection)}
      <div className="mt-auto pt-3">{renderItem(settingsNavItem(locale), counts)}</div>
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
  const t = useTranslations('nav');
  const [collapsed, toggle] = useCollapsed();

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150 md:flex',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-sidebar-border px-2">
        {collapsed ? null : (
          <Link
            href={`/${locale}/my-work`}
            className="flex-1 truncate px-2 font-semibold tracking-tight text-sidebar-foreground"
          >
            {activeBrand.name}
          </Link>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('expandMenu') : t('collapseMenu')}
          title={collapsed ? t('expandMenu') : t('collapseMenu')}
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
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
