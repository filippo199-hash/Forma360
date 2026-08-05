import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { brandHasModule } from '@forma360/shared/brand';
import { activeBrand } from '../../../src/lib/brand';
import { signInHref } from '../../../src/lib/sign-in-redirect';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { ModuleShell } from '../../../src/components/module-shell';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Incident Management shell (FreeHS B5). Brand-gated at the routing
 * layer (ADR 0010) — a brand without the module 404s the whole subtree —
 * and wraps the pages in `PermissionsProvider` so they can read
 * `useHasPermission('incidents.*')`. The server still enforces both
 * gates regardless.
 */
export default async function IncidentsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!brandHasModule(activeBrand.id, 'incidents')) {
    notFound();
  }

  const { permissions, session } = await loadCurrentUserPermissions();
  if (session === null) {
    redirect(signInHref(locale, (await headers()).get('x-pathname')));
  }

  return (
    <PermissionsProvider permissions={permissions}>
      <ModuleShell>{children}</ModuleShell>
    </PermissionsProvider>
  );
}
