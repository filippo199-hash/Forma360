import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { SettingsNav } from '../../../src/components/settings/settings-nav';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Settings shell: sidebar nav + permissions context. An admin (holds
 * `org.settings`) sees every section; a standard user only sees
 * "My profile" — the layout itself is the gate for that decision.
 * The server is still the source of truth for every mutation; the UI
 * only uses the permission list for display enablement.
 *
 * Sidebar highlighting + the client-only `usePathname` hook live in
 * `<SettingsNav>` so this layout stays a server component and can
 * still run the redirect-non-admin guard server-side.
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
      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-8">
        <SettingsNav locale={locale} isAdmin={isAdmin} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </PermissionsProvider>
  );
}
