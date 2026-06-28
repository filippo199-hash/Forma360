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
      {/* Full-width shell so a page (e.g. the observation detail) can bleed a
          tinted canvas to the content edges; the top tabs + non-detail pages
          re-constrain themselves to max-w-[1200px]. */}
      <div className="flex min-h-screen w-full flex-col bg-[#eef4fb] px-4 py-6 dark:bg-slate-900/40 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-[1200px]">
          <ObservationsTabs locale={locale} />
        </div>
        {children}
      </div>
    </PermissionsProvider>
  );
}
