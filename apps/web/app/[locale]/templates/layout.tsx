import { setRequestLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { signInHref } from '../../../src/lib/sign-in-redirect';
import type { ReactNode } from 'react';
import { PermissionsProvider } from '../../../src/lib/permissions-context';
import { ModuleShell } from '../../../src/components/module-shell';
import { ModuleTabs } from '../../../src/components/module-tabs';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * Template shell.
 *
 * SWP-G1: this gated on `grantsAdminAccess` — a Phase-2 simplification
 * ("mirror the /settings pages") that the permission catalogue has since
 * outgrown. `templates.view` and `templates.manage` are real keys, the
 * router enforces both (including the non-manager access-rule branch),
 * and the seeded **Manager** set's own description promises "Create
 * templates" — yet a Manager clicking Templates was redirected to My
 * profile without a word. The product was contradicting its own
 * permission-set copy.
 *
 * The gate is now the permission the router actually checks, and a
 * refusal explains itself instead of bouncing the reader somewhere
 * unrelated. Mutations stay server-enforced on `templates.manage`
 * (ground rule 6).
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
    redirect(signInHref(locale, (await headers()).get('x-pathname')));
  }
  if (!permissions.includes('templates.view')) {
    const t = await getTranslations({ locale, namespace: 'templates.noAccess' });
    return (
      <ModuleShell>
        <div className="mx-auto max-w-md px-6 py-16 text-center">
          <h1 className="text-lg font-semibold">{t('title')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('body')}</p>
        </div>
      </ModuleShell>
    );
  }

  return (
    <PermissionsProvider permissions={permissions}>
      <ModuleShell>
        <ModuleTabs />
        {children}
      </ModuleShell>
    </PermissionsProvider>
  );
}
