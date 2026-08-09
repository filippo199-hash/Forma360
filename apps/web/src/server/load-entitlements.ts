import { tenants } from '@forma360/db/schema';
import {
  PLAN_ENTITLEMENTS,
  planFromSettings,
  type EntitlementKey,
} from '@forma360/shared/entitlements';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { auth } from './auth';
import { db } from './db';

/**
 * Server-side helper for RSC: the current tenant's entitlement keys
 * (ADR 0018). Unauthenticated / tenantless requests get none. UX-only —
 * every paid surface re-checks via `requireEntitlement` at the tRPC layer.
 */
export async function loadCurrentTenantEntitlements(): Promise<readonly EntitlementKey[]> {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const tenantId = session?.user.tenantId;
  if (typeof tenantId !== 'string') return [];
  const rows = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return PLAN_ENTITLEMENTS[planFromSettings(rows[0]?.settings)];
}
