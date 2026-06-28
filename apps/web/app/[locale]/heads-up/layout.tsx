import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Heads Up shell. Wraps children in PermissionsProvider so pages can
 * read headsUp.* permissions via useHasPermission. Mirrors the Actions
 * layout pattern.
 */
export default async function HeadsUpLayout({
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
      <div className="min-h-screen w-full bg-[#eef4fb] dark:bg-slate-900/40">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-8">{children}</div>
      </div>
    </PermissionsProvider>
  );
}
