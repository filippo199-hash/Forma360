import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { signInHref } from '../../../src/lib/sign-in-redirect';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { ModuleShell } from '../../../src/components/module-shell';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Heads Up shell. Wraps children in PermissionsProvider so pages can
 * read headsUp.* permissions via useHasPermission. Mirrors the Actions
 * layout pattern.
 */
export default async function HeadsUpLayout({
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
      <ModuleShell>{children}</ModuleShell>
    </PermissionsProvider>
  );
}
