import { useLocale } from 'next-intl';
import Link from 'next/link';

export function SiteFooter() {
  const locale = useLocale();
  const year = new Date().getFullYear();
  const links = [
    { href: `/${locale}/about`, label: 'About' },
    { href: `/${locale}/privacy`, label: 'Privacy' },
    { href: `/${locale}/terms`, label: 'Terms' },
    { href: `/${locale}/data-deletion`, label: 'Data deletion' },
    { href: `/${locale}/contact`, label: 'Contact' },
  ];
  return (
    <footer className="border-t text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <span>© {year} Forma360</span>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="transition-colors hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
