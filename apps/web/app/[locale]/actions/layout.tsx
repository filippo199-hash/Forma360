import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { signInHref } from '../../../src/lib/sign-in-redirect';
import type { ReactNode } from 'react';
import { ModuleTabs } from '../../../src/components/module-tabs';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Actions shell. Wraps the children in `PermissionsProvider` so the
 * list / detail / create pages can read `useHasPermission('actions.*')`.
 * Without this layout the context defaults to `[]` and every button on
 * the page hides itself even when the caller is an administrator —
 * server still enforces the perm checks regardless. Mirrors the other
 * module layouts (observations, inspections, schedules, templates).
 */
export default async function ActionsLayout({
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

  return (
    <PermissionsProvider permissions={permissions}>
      {/* Full-width blue canvas so the board page can bleed a tinted panel to
          the content edges; non-board pages re-constrain themselves to
          max-w-[1200px]. The background matches the ModuleShell the centered
          modules use, so the two read as one surface. */}
      <div className="flex min-h-screen w-full flex-col bg-[#eef4fb] px-4 py-4 dark:bg-slate-900/40 sm:px-6 sm:py-6 lg:px-8">
        <div className="mx-auto w-full max-w-[1200px]">
          <ModuleTabs />
        </div>
        {children}
      </div>
    </PermissionsProvider>
  );
}
