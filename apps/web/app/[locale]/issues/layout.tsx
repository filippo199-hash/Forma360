import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Issues shell. Like `/inspections`, viewing and reporting issues is a
 * non-admin capability — we only gate the routes on having a session and
 * defer the finer-grained permission checks to the tRPC layer. The
 * server remains the source of truth for `issues.view`, `issues.report`,
 * `issues.manage`, and `issues.settings`.
 */
export default async function IssuesLayout({
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
      <div className="mx-auto min-h-screen w-full max-w-6xl px-4 py-8">{children}</div>
    </PermissionsProvider>
  );
}
