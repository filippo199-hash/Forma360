import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { signInHref } from '../../../src/lib/sign-in-redirect';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { SettingsTabs } from '../../../src/components/settings/settings-tabs';
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
    redirect(signInHref(locale, (await headers()).get('x-pathname')));
  }

  const isAdmin = grantsAdminAccess(permissions);

  // Render inside the normal app layout (global header + platform sidebar).
  // Settings sections are switched via a horizontal tab bar rather than a
  // separate settings-only sidebar.
  return (
    <PermissionsProvider permissions={permissions}>
      {/* Light-blue canvas matching every module (ModuleShell); the tab
          strip and each section's cards/tables sit on it as white surfaces. */}
      <div className="min-h-screen w-full bg-muted dark:bg-slate-900/40">
        <div className="mx-auto max-w-[1200px] px-6 py-8">
          <SettingsTabs locale={locale} isAdmin={isAdmin} />
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </PermissionsProvider>
  );
}
