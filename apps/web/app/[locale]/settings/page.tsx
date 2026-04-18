import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { redirect } from 'next/navigation';
import { loadCurrentUserPermissions } from '../../../src/server/load-permissions';

/**
 * /<locale>/settings — redirect admins to /settings/users, standards
 * to /settings/profile. Keeps `/settings` a single well-known entry
 * point that does the right thing regardless of permissions.
 */
export default async function SettingsIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { permissions } = await loadCurrentUserPermissions();
  if (grantsAdminAccess(permissions)) {
    redirect(`/${locale}/settings/users`);
  }
  redirect(`/${locale}/settings/profile`);
}
