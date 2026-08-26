import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { signInHref } from '../../../src/lib/sign-in-redirect';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { ModuleShell } from '../../../src/components/module-shell';
import { ModuleTabs } from '../../../src/components/module-tabs';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Approvals shell. Any authed user can land here; the server-side
 * `inspections.manage` check on `approvals.approve` / `approvals.reject`
 * remains the source of truth. The UI hides destructive buttons for
 * users who lack the permission (UX only — ground rule #6).
 */
export default async function ApprovalsLayout({
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
      <ModuleShell>
        <ModuleTabs />
        {children}
      </ModuleShell>
    </PermissionsProvider>
  );
}
