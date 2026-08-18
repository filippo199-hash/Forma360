import { useLocale } from 'next-intl';
import Link from 'next/link';
import { scenariosForBrand } from '@forma360/shared/sandbox-scenarios';
import { marketingModules } from '../content/modules';
import { FOOTER, NAV, PRICING } from '../content/site';
import { activeBrand } from '../lib/brand';

/**
 * Public-site footer: a proper marketing footer — brand column, the full
 * module list (from the brand-filtered catalogue), resources and company
 * links — over the legal bottom bar. Rendered on public pages only; the
 * signed-in app shell has no footer.
 */
export function SiteFooter() {
  const locale = useLocale();
  const year = new Date().getFullYear();
  const modules = marketingModules();
  const hasSandbox = scenariosForBrand(activeBrand.id).length > 0;

  const resources: Array<{ href: string; label: string }> = [
    { href: `/${locale}/docs`, label: FOOTER.labels.guides },
    { href: `/${locale}/product`, label: FOOTER.labels.allModules },
    ...(hasSandbox ? [{ href: `/${locale}/try`, label: NAV.tryFree }] : []),
    ...(PRICING !== null ? [{ href: `/${locale}/pricing`, label: NAV.pricing }] : []),
    { href: `/${locale}/sign-up`, label: NAV.getStarted },
  ];

  const company: Array<{ href: string; label: string }> = [
    { href: `/${locale}/about`, label: FOOTER.labels.about },
    { href: `/${locale}/security`, label: FOOTER.labels.security },
    { href: `/${locale}/contact`, label: FOOTER.labels.contact },
    { href: `/${locale}/privacy`, label: FOOTER.labels.privacy },
    { href: `/${locale}/terms`, label: FOOTER.labels.terms },
    { href: `/${locale}/data-deletion`, label: FOOTER.labels.dataDeletion },
  ];

  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_2fr_1fr_1fr]">
        {/* Brand */}
        <div>
          <Link href={`/${locale}`} className="font-display text-lg font-bold tracking-tight">
            {activeBrand.name}
          </Link>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
            {FOOTER.tagline}
          </p>
        </div>

        {/* Modules */}
        <nav aria-label={FOOTER.modulesHeading}>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground/60">
            {FOOTER.modulesHeading}
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
            {modules.map((module) => (
              <li key={module.slug}>
                <Link
                  href={`/${locale}/product/${module.slug}`}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {module.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Resources */}
        <nav aria-label={FOOTER.resourcesHeading}>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground/60">
            {FOOTER.resourcesHeading}
          </p>
          <ul className="mt-4 space-y-2">
            {resources.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Company */}
        <nav aria-label={FOOTER.companyHeading}>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground/60">
            {FOOTER.companyHeading}
          </p>
          <ul className="mt-4 space-y-2">
            {company.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted-foreground">
          © {year} {activeBrand.legalName} · Company No. {activeBrand.companyNumber} · Registered in
          England &amp; Wales
        </div>
      </div>
    </footer>
  );
}
