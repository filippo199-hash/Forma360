import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Inspections shell. Unlike `/templates`, conducting inspections is a
 * non-admin capability — we gate the routes on having ANY session and
 * defer the finer-grained permission checks to the tRPC layer. The server
 * remains the source of truth for `inspections.view` / `inspections.conduct`.
 */
export default async function InspectionsLayout({
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
