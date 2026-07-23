import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Template admin shell. Phase 2 templates are gated behind the admin
 * check to mirror the existing `/settings` pages — the server tRPC
 * procedures remain the source of truth for every permission check, but
 * non-admins have no UI entry point at all.
 */
export default async function TemplatesLayout({
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
  if (!grantsAdminAccess(permissions)) {
    redirect(`/${locale}/settings/profile`);
  }

  return (
    <PermissionsProvider permissions={permissions}>
      <div className="min-h-screen w-full bg-[#eef4fb] dark:bg-slate-900/40">
        {/* No padding here — the page provides its own px-4 py-6, matching the
         * sibling Inspections / Approvals / Schedules tab layouts. */}
        <div className="mx-auto w-full max-w-[1200px]">{children}</div>
      </div>
    </PermissionsProvider>
  );
}
