import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { signInHref } from '../../../src/lib/sign-in-redirect';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { ModuleShell } from '../../../src/components/module-shell';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Risk assessments shell (FreeHS B1). Wraps the children in
 * `PermissionsProvider` so the list / detail pages can read
 * `useHasPermission('riskAssessments.*')`. Without this layout the
 * context defaults to `[]` and every action button hides itself even for
 * administrators — the server still enforces the permission checks
 * regardless. Mirrors the other module layouts (actions, observations,
 * schedules, assets).
 */
export default async function RiskAssessmentsLayout({
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

  return (
    <PermissionsProvider permissions={permissions}>
      <ModuleShell>{children}</ModuleShell>
    </PermissionsProvider>
  );
}
