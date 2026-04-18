import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { headers } from 'next/headers';
import { auth } from './auth';
import { db } from './db';

/**
 * Server-side helper for RSC: returns the current user's permissions, or
 * an empty array if the request is unauthenticated. Used by the Settings
 * layout to populate the PermissionsProvider + gate admin sections.
 */
export async function loadCurrentUserPermissions(): Promise<{
  permissions: readonly string[];
  session: { userId: string; tenantId: string; email: string } | null;
}> {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (session === null || session.user.tenantId == null) {
    return { permissions: [], session: null };
  }
  const permissions = await loadUserPermissions(
    db,
    session.user.tenantId as string,
    session.user.id,
  );
  return {
    permissions,
    session: {
      userId: session.user.id,
      tenantId: session.user.tenantId as string,
      email: session.user.email,
    },
  };
}
