import { useLocale, useTranslations } from 'next-intl';
import { headers } from 'next/headers';
import Link from 'next/link';
import { auth } from '../server/auth';
import { UserMenu } from './header/user-menu';
import { LocalePicker } from './locale-picker';
import { ThemeToggle } from './theme-toggle';

export async function SiteHeader() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);

  return <SiteHeaderInner session={session} />;
}

function SiteHeaderInner({
  session,
}: {
  session: Awaited<ReturnType<typeof auth.api.getSession>> | null;
}) {
  const t = useTranslations('common');
  const locale = useLocale();

  return (
    <header className="border-b">
      <div className="flex items-center justify-between px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight">
          Forma360
        </Link>
        <nav aria-label={t('navigation.primary')} className="flex items-center gap-3">
          <LocalePicker />
          <ThemeToggle />
          {session !== null ? (
            <UserMenu
              name={session.user.name ?? ''}
              email={session.user.email}
              locale={locale}
            />
          ) : null}
        </nav>
      </div>
    </header>
  );
}
