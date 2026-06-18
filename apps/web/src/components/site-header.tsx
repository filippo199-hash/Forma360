import { user } from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { useLocale, useTranslations } from 'next-intl';
import { headers } from 'next/headers';
import Link from 'next/link';
import { auth } from '../server/auth';
import { db } from '../server/db';
import { NAV } from '../content/site';
import { GlobalSearch } from './global-search';
import { UserMenu } from './header/user-menu';

export async function SiteHeader() {
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

  return <SiteHeaderInner session={session} displayName={displayName} />;
}

function SiteHeaderInner({
  session,
  displayName,
}: {
  session: Awaited<ReturnType<typeof auth.api.getSession>> | null;
  displayName: string;
}) {
  const t = useTranslations('common');
  const locale = useLocale();

  return (
    <header className="border-b">
      <div className="flex items-center justify-between px-4 py-2.5">
        <Link href="/" className="font-semibold tracking-tight">
          Forma360
        </Link>
        <nav aria-label={t('navigation.primary')} className="flex items-center gap-2 sm:gap-3">
          {session !== null ? <GlobalSearch /> : null}
          {session !== null ? (
            <UserMenu name={displayName} email={session.user.email} locale={locale} />
          ) : (
            <>
              <Link
                href={`/${locale}/sign-in`}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {NAV.signIn}
              </Link>
              <Link
                href={`/${locale}/sign-up`}
                className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-foreground transition-transform hover:-translate-y-0.5"
              >
                {NAV.getStarted}
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
