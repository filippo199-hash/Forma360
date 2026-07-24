import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { signInHref } from '../../../src/lib/sign-in-redirect';
import type { ReactNode } from 'react';
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
      {/* Full-width shell so the board page can bleed a tinted canvas to the
          content edges; non-board pages re-constrain themselves to max-w-[1200px]. */}
      <div className="flex min-h-screen w-full flex-col px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        {children}
      </div>
    </PermissionsProvider>
  );
}
