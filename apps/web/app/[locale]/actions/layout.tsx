import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Actions shell. Wraps the children in `PermissionsProvider` so the
 * list / detail / create pages can read `useHasPermission('actions.*')`.
 * Without this layout the context defaults to `[]` and every button on
 * the page hides itself even when the caller is an administrator —
 * server still enforces the perm checks regardless. Mirrors the other
 * module layouts (observations, inspections, schedules, templates).
 */
export default async function ActionsLayout({
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
