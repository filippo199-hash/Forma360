/**
 * Tenant data export (platform HSE review PF-31: "no tenant data export").
 *
 * GET → a single JSON document with the tenant's core records, for data
 * portability / offboarding. Gated on `org.settings` (administrators).
 * Users are exported without auth material (no password hashes, no
 * sessions); binary objects stay in storage — their keys are included so
 * a follow-up fetch can pull them.
 */
import {
  actions,
  assets,
  contractors,
  coshhAssessments,
  coshhSubstances,
  documents,
  fireBuildings,
  fireLogbookEntries,
  fireRiskAssessments,
  groups,
  headsUps,
  inspections,
  issues,
  permits,
  riskAssessments,
  sites,
  templates,
  tenants,
  user,
} from '@forma360/db/schema';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '../../../../src/server/auth';
import { db } from '../../../../src/server/db';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  const tenantId = (session?.user as { tenantId?: string } | undefined)?.tenantId;
  const userId = session?.user.id;
  if (session === null || tenantId === undefined || userId === undefined) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const perms = await loadUserPermissions(db, tenantId, userId);
  if (!perms.includes('org.settings') && !grantsAdminAccess(perms)) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const [tenantRows, userRows] = await Promise.all([
    db.select().from(tenants).where(eq(tenants.id, tenantId)),
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        locale: user.locale,
        createdAt: user.createdAt,
        deactivatedAt: user.deactivatedAt,
      })
      .from(user)
      .where(eq(user.tenantId, tenantId)),
  ]);

  // Every exported table carries tenant_id (ADR 0002); listed explicitly so
  // the compiler checks each column reference.
  const data: Record<string, unknown[]> = {
    groups: await db.select().from(groups).where(eq(groups.tenantId, tenantId)),
    sites: await db.select().from(sites).where(eq(sites.tenantId, tenantId)),
    templates: await db.select().from(templates).where(eq(templates.tenantId, tenantId)),
    inspections: await db.select().from(inspections).where(eq(inspections.tenantId, tenantId)),
    issues: await db.select().from(issues).where(eq(issues.tenantId, tenantId)),
    actions: await db.select().from(actions).where(eq(actions.tenantId, tenantId)),
    headsUps: await db.select().from(headsUps).where(eq(headsUps.tenantId, tenantId)),
    assets: await db.select().from(assets).where(eq(assets.tenantId, tenantId)),
    documents: await db.select().from(documents).where(eq(documents.tenantId, tenantId)),
    contractors: await db.select().from(contractors).where(eq(contractors.tenantId, tenantId)),
    permits: await db.select().from(permits).where(eq(permits.tenantId, tenantId)),
    riskAssessments: await db
      .select()
      .from(riskAssessments)
      .where(eq(riskAssessments.tenantId, tenantId)),
    coshhSubstances: await db
      .select()
      .from(coshhSubstances)
      .where(eq(coshhSubstances.tenantId, tenantId)),
    coshhAssessments: await db
      .select()
      .from(coshhAssessments)
      .where(eq(coshhAssessments.tenantId, tenantId)),
    fireBuildings: await db
      .select()
      .from(fireBuildings)
      .where(eq(fireBuildings.tenantId, tenantId)),
    fireRiskAssessments: await db
      .select()
      .from(fireRiskAssessments)
      .where(eq(fireRiskAssessments.tenantId, tenantId)),
    fireLogbookEntries: await db
      .select()
      .from(fireLogbookEntries)
      .where(eq(fireLogbookEntries.tenantId, tenantId)),
  };

  const body = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      tenant: tenantRows[0] ?? null,
      users: userRows,
      ...data,
    },
    null,
    1,
  );
  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="tenant-export-${tenantId}.json"`,
      'cache-control': 'no-store',
    },
  });
}
