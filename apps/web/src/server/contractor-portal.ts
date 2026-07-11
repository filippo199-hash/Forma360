/**
 * Server helpers for the external-contractor portal (Phase 4).
 *
 * An external contractor user is confined to `/portal` plus the route prefixes
 * their granted activities unlock. Internal users have no `contractor_users`
 * row and are unaffected.
 */
import { contractorUsers } from '@forma360/db/schema';
import { activitiesToRoutePrefixes } from '@forma360/permissions/contractor-activities';
import { and, eq } from 'drizzle-orm';
import { db } from './db';

export interface ContractorUserMembership {
  contractorId: string;
  activities: string[];
  acknowledgedAt: Date | null;
}

/** The signed-in user's contractor-portal membership, or null for internal users. */
export async function loadContractorUser(
  userId: string,
  tenantId: string,
): Promise<ContractorUserMembership | null> {
  const rows = await db
    .select({
      contractorId: contractorUsers.contractorId,
      activities: contractorUsers.activities,
      acknowledgedAt: contractorUsers.acknowledgedAt,
    })
    .from(contractorUsers)
    .where(and(eq(contractorUsers.tenantId, tenantId), eq(contractorUsers.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  return {
    contractorId: row.contractorId,
    activities: row.activities,
    acknowledgedAt: row.acknowledgedAt,
  };
}

/**
 * Whether an external user with the given activities may open `pathname`
 * (a locale-prefixed path like `/en/inspections/123`). Always allows the
 * portal, the sign-in/home routes, and each activity's route prefix.
 */
export function isPathAllowedForExternal(
  pathname: string,
  locale: string,
  activities: readonly string[],
): boolean {
  const rel = pathname.startsWith(`/${locale}`) ? pathname.slice(locale.length + 1) : pathname;
  const normalized = rel === '' ? '/' : rel;
  // Home + sign-in are always reachable (sign-out lands here).
  if (normalized === '/' || normalized.startsWith('/sign-in')) return true;
  return activitiesToRoutePrefixes(activities).some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}
