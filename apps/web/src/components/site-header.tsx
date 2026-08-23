import { tenants, user } from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { Settings, Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { headers } from 'next/headers';
import Link from 'next/link';
import { scenariosForBrand } from '@forma360/shared/sandbox-scenarios';
import { auth } from '../server/auth';
import { db } from '../server/db';
import { NAV, PRICING } from '../content/site';
import { activeBrand } from '../lib/brand';
import { settingsNavItem } from '../lib/nav-model';
import { NotificationBell } from './notification-bell';
import { UserMenu } from './header/user-menu';
import { WorkspaceMenu } from './header/workspace-menu';
import { MobileNav } from './mobile-nav';
import { MarketingMobileNav } from './marketing-mobile-nav';

export async function SiteHeader({ showBrand = true }: { showBrand?: boolean }) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);

  // The better-auth session caches the name from sign-in time, so a profile
  // rename wouldn't show until re-login. Read the live first/last name from
  // the user row (and the workspace name for the top-left switcher).
  let displayName = session?.user.name ?? '';
  let workspaceName = '';
  if (session !== null) {
    const rows = await db
      .select({
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        workspaceName: tenants.name,
      })
      .from(user)
      .innerJoin(tenants, eq(user.tenantId, tenants.id))
      .where(eq(user.id, session.user.id))
      .limit(1)
      .catch(() => []);
    const u = rows[0];
    if (u !== undefined) {
      displayName = u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.name;
      workspaceName = u.workspaceName;
    }
  }

  return (
    <SiteHeaderInner
      session={session}
      displayName={displayName}
      workspaceName={workspaceName}
      showBrand={showBrand}
    />
  );
}

function SiteHeaderInner({
  session,
  displayName,
  workspaceName,
  showBrand,
}: {
  session: Awaited<ReturnType<typeof auth.api.getSession>> | null;
  displayName: string;
  workspaceName: string;
  showBrand: boolean;
}) {
  const t = useTranslations('common');
  const locale = useLocale();

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      {/* Fixed 56px so the sidebar below can stick to exactly that offset. */}
      <div className="flex h-14 items-center justify-between px-2.5 sm:px-4">
        {/* One bar across the whole app. Top-left in the shell: the product
         * wordmark, then the signed-in email opening the workspace list —
         * the Cloudflare arrangement. The tenant's own logo stays on its
         * PDF letterheads; the chrome carries the product. */}
        {showBrand ? (
          <Link href="/" className="font-semibold tracking-tight">
            {activeBrand.name}
          </Link>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            {session !== null ? <MobileNav locale={locale} /> : null}
            <Link href={`/${locale}/my-work`} className="flex min-w-0 items-center px-1">
              {/* The wordmark as a small tile — white on black, matching the
                  brand asset. A logo is a fixed-colour mark, so it does not
                  follow the theme. */}
              <span className="inline-flex items-center rounded-md bg-black px-2 py-1 text-sm font-bold leading-none tracking-tight text-white">
                {activeBrand.name}
              </span>
            </Link>
            {session !== null ? (
              <WorkspaceMenu email={session.user.email} workspaceName={workspaceName} />
            ) : null}
          </div>
        )}
        <nav aria-label={t('navigation.primary')} className="flex items-center gap-1 sm:gap-2">
          {session !== null ? (
            <>
              {/* The assistant and Settings moved out of the rail and up
               * here (labels fold to icons below sm). */}
              <Link
                href={`/${locale}/ai`}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{t('askAi')}</span>
                <span className="sr-only sm:hidden">{t('askAi')}</span>
              </Link>
              <Link
                href={settingsNavItem(locale).href}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <Settings className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{t('settingsLink')}</span>
                <span className="sr-only sm:hidden">{t('settingsLink')}</span>
              </Link>
            </>
          ) : null}
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
