import { user } from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { useLocale, useTranslations } from 'next-intl';
import { headers } from 'next/headers';
import Link from 'next/link';
import { scenariosForBrand } from '@forma360/shared/sandbox-scenarios';
import { auth } from '../server/auth';
import { db } from '../server/db';
import { NAV, PRICING } from '../content/site';
import { activeBrand } from '../lib/brand';
import { GlobalSearch } from './global-search';
import { NavCollapseToggle } from './nav/nav-collapse-toggle';
import { NotificationBell } from './notification-bell';
import { UserMenu } from './header/user-menu';
import { MobileNav } from './mobile-nav';
import { MarketingMobileNav } from './marketing-mobile-nav';

export async function SiteHeader({
  showBrand = true,
  logoUrl = null,
}: {
  showBrand?: boolean;
  /**
   * Tenant logo URL (ADR 0018). Only meaningful in the app shell, where
   * the header carries the wordmark for the whole width.
   */
  logoUrl?: string | null;
}) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);

  // The better-auth session caches the name from sign-in time, so a profile
  // rename wouldn't show until re-login. Read the live first/last name from
  // the user row and prefer "First Last" for the header label.
  let displayName = session?.user.name ?? '';
  if (session !== null) {
    const rows = await db
      .select({ name: user.name, firstName: user.firstName, lastName: user.lastName })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)
      .catch(() => []);
    const u = rows[0];
    if (u !== undefined) {
      displayName = u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.name;
    }
  }

  return (
    <SiteHeaderInner
      session={session}
      displayName={displayName}
      showBrand={showBrand}
      logoUrl={logoUrl}
    />
  );
}

function SiteHeaderInner({
  session,
  displayName,
  showBrand,
  logoUrl,
}: {
  session: Awaited<ReturnType<typeof auth.api.getSession>> | null;
  displayName: string;
  showBrand: boolean;
  logoUrl: string | null;
}) {
  const t = useTranslations('common');
  const locale = useLocale();

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      {/* Fixed 56px so the sidebar below can stick to exactly that offset. */}
      <div className="flex h-14 items-center justify-between px-2.5 sm:px-4">
        {/* One bar across the whole app: the rail no longer opens with a
         * header of its own, so the fold control and the wordmark sit
         * here, left-aligned over the rail they belong to. */}
        {showBrand ? (
          <Link href="/" className="font-semibold tracking-tight">
            {activeBrand.name}
          </Link>
        ) : (
          <div className="flex min-w-0 items-center gap-1">
            {session !== null ? <MobileNav locale={locale} /> : null}
            {session !== null ? <NavCollapseToggle /> : null}
            <Link
              href={`/${locale}/my-work`}
              className="flex min-w-0 items-center truncate px-1 text-[15px] font-semibold tracking-tight"
            >
              {/* ADR 0018: the tenant's own logo replaces the wordmark. */}
              {logoUrl !== null && logoUrl !== '' ? (
                <img
                  src={logoUrl}
                  alt={activeBrand.name}
                  className="h-7 w-auto max-w-[180px] object-contain"
                />
              ) : (
                activeBrand.name
              )}
            </Link>
          </div>
        )}
        <nav aria-label={t('navigation.primary')} className="flex items-center gap-2 sm:gap-3">
          {session !== null ? <GlobalSearch /> : null}
          {/* PF-23: the in-app notification centre. */}
          {session !== null ? <NotificationBell /> : null}
          {session !== null ? (
            <UserMenu name={displayName} email={session.user.email} locale={locale} />
          ) : (
            <>
              {/* Marketing nav — inline from md: up; below that the
               * burger menu at the end of the row carries the same links. */}
              <Link
                href={`/${locale}/product`}
                className="hidden rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
              >
                {NAV.modules}
              </Link>
              <Link
                href={`/${locale}/docs`}
                className="hidden rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
              >
                {NAV.docs}
              </Link>
              {PRICING !== null ? (
                <Link
                  href={`/${locale}/pricing`}
                  className="hidden rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
                >
                  {NAV.pricing}
                </Link>
              ) : null}
              <Link
                href={`/${locale}/sign-in`}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {NAV.signIn}
              </Link>
              {scenariosForBrand(activeBrand.id).length > 0 ? (
                <Link
                  href={`/${locale}/try`}
                  className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-foreground transition-transform hover:-translate-y-0.5"
                >
                  {NAV.tryFree}
                </Link>
              ) : (
                <Link
                  href={`/${locale}/sign-up`}
                  className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-foreground transition-transform hover:-translate-y-0.5"
                >
                  {NAV.getStarted}
                </Link>
              )}
              <MarketingMobileNav locale={locale} />
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
