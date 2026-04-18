import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
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
    redirect(`/${locale}`);
  }

  return (
    <PermissionsProvider permissions={permissions}>
      <div className="mx-auto min-h-screen w-full max-w-5xl">{children}</div>
    </PermissionsProvider>
  );
}
