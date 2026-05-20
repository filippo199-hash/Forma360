import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';
import { ObservationsTabs } from './_components/observations-tabs';

/**
 * Observations shell. Like `/inspections`, viewing and reporting
 * observations is a non-admin capability — we only gate the routes on
 * having a session and defer the finer-grained permission checks to the
 * tRPC layer. The server remains the source of truth for `issues.view`,
 * `issues.report`, `issues.manage`, and `issues.settings`. The backend
 * router namespace is still `trpc.issues.*` — only the URLs and
 * user-facing labels have been renamed to "Observations" as part of the
 * Phase 3 prep.
 */
export default async function ObservationsLayout({
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
      <div className="mx-auto min-h-screen w-full max-w-[1200px] px-4 py-8">
        <ObservationsTabs locale={locale} />
        {children}
      </div>
    </PermissionsProvider>
  );
}
