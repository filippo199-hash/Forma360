import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Settings shell: sidebar nav + permissions context. An admin (holds
 * `org.settings`) sees every section; a standard user only sees
 * "My profile" — the layout itself is the gate for that decision.
 * The server is still the source of truth for every mutation; the UI
 * only uses the permission list for display enablement.
 */
export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { permissions, session } = await loadCurrentUserPermissions();
  if (session === null) {
    redirect(`/${locale}`);
  }

  const isAdmin = grantsAdminAccess(permissions);

  return (
    <PermissionsProvider permissions={permissions}>
      <div className="mx-auto flex max-w-6xl gap-8 px-4 py-8">
        <SettingsNav locale={locale} isAdmin={isAdmin} />
        <section className="min-w-0 flex-1">{children}</section>
      </div>
    </PermissionsProvider>
  );
}

function SettingsNav({ locale, isAdmin }: { locale: string; isAdmin: boolean }) {
  const t = useTranslations('settings');

  const adminSections = [
    { key: 'users', href: `/${locale}/settings/users` },
    { key: 'permissions', href: `/${locale}/settings/permissions` },
    { key: 'groups', href: `/${locale}/settings/groups` },
    { key: 'sites', href: `/${locale}/settings/sites` },
    { key: 'customFields', href: `/${locale}/settings/custom-fields` },
  ] as const;

  const placeholderSections = [
    { key: 'templates', phase: 2 },
    { key: 'issues', phase: 3 },
    { key: 'actions', phase: 4 },
    { key: 'headsUp', phase: 5 },
    { key: 'assets', phase: 5 },
    { key: 'documents', phase: 5 },
    { key: 'compliance', phase: 8 },
    { key: 'training', phase: 10 },
    { key: 'integrations', phase: 10 },
    { key: 'billing', phase: 10 },
  ] as const;

  return (
    <aside className="w-56 shrink-0">
      <h2 className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('title')}
      </h2>
      <nav aria-label={t('title')} className="flex flex-col gap-1 text-sm">
        {isAdmin ? (
          <>
            {adminSections.map((s) => (
              <Link key={s.key} href={s.href} className="rounded-md px-3 py-2 hover:bg-accent">
                {t(`nav.${s.key}`)}
              </Link>
            ))}
            <div className="mt-6 border-t pt-4">
              {placeholderSections.map((s) => (
                <div
                  key={s.key}
                  className="px-3 py-1.5 text-xs text-muted-foreground"
                  aria-disabled
                >
                  {t(`nav.${s.key}`)} · {t('comingInPhase', { phase: s.phase })}
                </div>
              ))}
            </div>
          </>
        ) : null}
        <Link href={`/${locale}/settings/profile`} className="rounded-md px-3 py-2 hover:bg-accent">
          {t('nav.profile')}
        </Link>
      </nav>
    </aside>
  );
}
