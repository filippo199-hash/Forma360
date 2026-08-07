'use client';

/**
 * The in-page tab strip a module shows at the top of its list pages
 * (ADR 0014 amendment). It replaces the sidebar's inline sub-navigation:
 * clicking a module in the menu no longer expands it — the sub-pages live
 * on the page itself, as tabs, exactly as Inspections and Training already
 * do.
 *
 * Driven entirely by the one nav model (`nav-model.ts`), so the tabs are
 * the same set the sidebar used to reveal — brand- and permission-gated the
 * same way — with no second list to keep in step. The strip shows only on a
 * module's tab pages (its landing and each child); it renders nothing on the
 * detail, form and editor routes deeper than the tabs, matching the existing
 * tab bars. Mount it once inside a module's `ModuleShell`.
 */
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { activeBrand } from '../lib/brand';
import { buildNavSections, moduleTabsForPath } from '../lib/nav-model';
import { usePermissionList } from '../lib/permissions-context';

export function ModuleTabs() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const permissions = usePermissionList();

  const sections = buildNavSections({ locale, brandId: activeBrand.id, permissions });
  const strip = moduleTabsForPath(sections, pathname);
  if (strip === undefined) return null;

  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b">
      {strip.tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.active ? 'page' : undefined}
          className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            tab.active
              ? 'border-foreground font-semibold text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {tab.isParent ? t(tab.key) : t(`child.${tab.key}`)}
        </Link>
      ))}
    </div>
  );
}
