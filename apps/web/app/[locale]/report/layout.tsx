import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { signInHref } from '../../../src/lib/sign-in-redirect';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Shell for the report chooser. Not brand-gated — the page decides which
 * routes to offer from the viewer's permissions and the brand catalogue,
 * and shows nothing it cannot honour.
 */
export default async function ReportLayout({
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
    redirect(signInHref(locale, (await headers()).get('x-pathname')));
  }

  return <PermissionsProvider permissions={permissions}>{children}</PermissionsProvider>;
}
