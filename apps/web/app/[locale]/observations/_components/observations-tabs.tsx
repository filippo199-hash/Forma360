'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../../../src/lib/cn';

interface ObservationsTabsProps {
  locale: string;
}

interface TabDef {
  key: 'observations' | 'categories' | 'qrCodes';
  href: string;
  match: (pathname: string) => boolean;
}

/**
 * Horizontal sub-nav for the `/observations/*` route group. Mirrors the
 * SafetyCulture pattern: a strip of three tabs — Observations, Categories,
 * QR codes — sits above the page content with the current tab underlined.
 *
 * "Observations" is active for the list, the `new` route, and any
 * `[observationId]` detail route. "Categories" is active for the
 * categories list and any category detail page. "QR codes" is the stub
 * landing for PR-2.
 */
export function ObservationsTabs({ locale }: ObservationsTabsProps) {
  const t = useTranslations('issues.tabs');
  const pathname = usePathname();

  const base = `/${locale}/observations`;

  const tabs: TabDef[] = [
    {
      key: 'observations',
      href: base,
      match: (p) =>
        p === base ||
        p === `${base}/new` ||
        (p.startsWith(`${base}/`) &&
          !p.startsWith(`${base}/categories`) &&
          !p.startsWith(`${base}/qr-codes`)),
    },
    {
      key: 'categories',
      href: `${base}/categories`,
      match: (p) => p === `${base}/categories` || p.startsWith(`${base}/categories/`),
    },
    {
      key: 'qrCodes',
      href: `${base}/qr-codes`,
      match: (p) => p === `${base}/qr-codes` || p.startsWith(`${base}/qr-codes/`),
    },
  ];

  return (
    <nav className="mb-6 flex gap-1 border-b border-slate-300 dark:border-slate-700" aria-label={t('observations')}>
      <div className="flex gap-6">
        {tabs.map((tab) => {
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.key}
              href={tab.href}
              className={cn(
                '-mb-px border-b-2 px-1 py-3 text-sm font-medium transition-colors',
                active
                  ? 'border-primary text-primary font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              aria-current={active ? 'page' : undefined}
            >
              {t(tab.key)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
