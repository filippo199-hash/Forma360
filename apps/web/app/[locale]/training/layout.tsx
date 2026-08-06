import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { brandHasModule } from '@forma360/shared/brand';
import { activeBrand } from '../../../src/lib/brand';
import { signInHref } from '../../../src/lib/sign-in-redirect';
import type { ReactNode } from 'react';
import { ModuleShell } from '../../../src/components/module-shell';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Training & competence shell (FreeHS B7). Brand-gated at the routing
 * layer (ADR 0010) — a brand without the module 404s the whole subtree —
 * and wraps the pages in `PermissionsProvider` so they can read
 * `useHasPermission('training.*')`. The server still enforces both gates
 * regardless.
 */
export default async function TrainingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!brandHasModule(activeBrand.id, 'training')) {
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
