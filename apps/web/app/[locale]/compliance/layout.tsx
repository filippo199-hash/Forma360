import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Compliance shell. Wraps children in PermissionsProvider so pages can
 * read compliance.* permissions via useHasPermission. Mirrors the Heads Up
 * layout pattern.
 */
export default async function ComplianceLayout({
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
      <div className="mx-auto min-h-screen w-full max-w-[1200px] px-4 py-8">{children}</div>
    </PermissionsProvider>
  );
}
