import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Schedules shell. Managing schedules is an admin capability
 * (`templates.schedules.manage`); viewing the calendar falls under
 * `inspections.view`. Finer gating lives at the tRPC boundary — the
 * layout just requires a session.
 */
export default async function SchedulesLayout({
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
