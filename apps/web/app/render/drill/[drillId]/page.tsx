/**
 * Internal Puppeteer render target for fire drill records (FreeHS
 * module B4). HMAC-gated via the `?token=` query string — see
 * `@forma360/render`'s `signRenderToken` / `verifyRenderToken`. Any
 * request without a valid token is 404ed (not 401: we don't want
 * automated scanners to learn the route exists).
 *
 * Not `[locale]`-prefixed: Puppeteer has no session — the route serves a
 * single-purpose print HTML page, not a user-facing view.
 */
import { verifyRenderToken, loadDrillSnapshot } from '@forma360/render';
import { fireDrills } from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import {
  DrillPrintLayout,
  type DrillPrintBranding,
} from '../../../../src/components/fire-safety/drill-print-layout';
import { env } from '../../../../src/server/env';
import { db } from '../../../../src/server/db';
import { loadTenantBrandingById } from '../../../../src/server/load-branding';

interface Props {
  params: Promise<{ drillId: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function RenderDrillPage({ params, searchParams }: Props) {
  const [{ drillId }, { token }] = await Promise.all([params, searchParams]);
  if (typeof token !== 'string') notFound();
  // The token signs the subject id (the field is named for its original
  // inspection use); a tampered id breaks the signature.
  const ok = verifyRenderToken({
    secret: env.RENDER_SHARED_SECRET,
    inspectionId: drillId,
    token,
  });
  if (!ok) notFound();

  // No session on this route — trust the HMAC + id binding, mirroring
  // /render/fra. ULIDs are globally unique so the tenant lookup by id
  // alone cannot cross tenants.
  const rows = await db
    .select({ tenantId: fireDrills.tenantId })
    .from(fireDrills)
    .where(eq(fireDrills.id, drillId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) notFound();

  const snapshot = await loadDrillSnapshot(db, { tenantId: row.tenantId, drillId });
  if (snapshot === null) notFound();

  // ADR 0018: tenant branding — company logo + palette in the header.
  const tenant = await loadTenantBrandingById(row.tenantId);
  const branding: DrillPrintBranding = {
    logoUrl: tenant.logoUrl,
    ...(tenant.branding?.primaryColor !== undefined
      ? { primaryColor: tenant.branding.primaryColor }
      : {}),
    ...(tenant.branding?.accentColor !== undefined
      ? { accentColor: tenant.branding.accentColor }
      : {}),
  };

  return <DrillPrintLayout snapshot={snapshot} branding={branding} />;
}
